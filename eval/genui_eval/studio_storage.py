# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Filesystem storage helpers for Eval Studio MVP."""

from __future__ import annotations

from enum import Enum
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .studio_types import (
    StudioArtifactKind,
    StudioCaseResult,
    StudioEvent,
    StudioRunDefinition,
    StudioRunPlan,
    StudioRunSummary,
    StudioAnnotation,
    StudioAnnotationType,
    StudioRunStatus,
    to_jsonable,
)


def build_default_studio_root(eval_root: Path | None = None) -> Path:
    """Return the repository-local Eval Studio root."""

    if eval_root is None:
        eval_root = Path(__file__).resolve().parents[2]
    if eval_root.name == "eval":
        eval_root = eval_root.parent
    return eval_root / ".genui-eval-studio"


class StudioStorage:
    """Persist run state and artifacts into a local filesystem tree."""

    def __init__(self, root: Path):
        self.root = root
        self.config_dir = root / "config"
        self.runs_dir = root / "runs"
        self.indexes_dir = root / "indexes"

    def ensure_root(self) -> None:
        """Create top-level storage directories if they do not exist."""

        for directory in (self.root, self.config_dir, self.runs_dir, self.indexes_dir):
            directory.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        return self.runs_dir / run_id

    def execution_dir(self, run_id: str, execution_id: str) -> Path:
        return self.run_dir(run_id) / "executions" / execution_id

    def execution_case_dir(self, run_id: str, execution_id: str, group_id: str, case_id: str) -> Path:
        return self.execution_dir(run_id, execution_id) / "groups" / group_id / "cases" / case_id

    def get_latest_execution_id(self, run_id: str) -> str | None:
        try:
            summary = self.read_json(self.run_dir(run_id) / "summary.json")
            return summary.get("metadata", {}).get("latest_execution_id")
        except Exception:
            return None

    def initialize_run(self, run_definition: StudioRunDefinition, run_plan: StudioRunPlan) -> Path:
        """Create the canonical directory structure for a run."""

        self.ensure_root()
        run_dir = self.run_dir(run_definition.run_id)
        (run_dir / "groups").mkdir(parents=True, exist_ok=True)

        self.write_json(run_dir / "run.json", run_definition)
        self.write_json(run_dir / "plan.json", run_plan)
        self.write_json(run_dir / "summary.json", self.build_summary(run_definition))
        self.write_json(run_dir / "protocol.json", self.protocol_snapshot(run_definition))
        (run_dir / "events.jsonl").touch(exist_ok=True)

        for group in run_definition.groups:
            group_dir = run_dir / "groups" / group.group_id
            (group_dir / "cases").mkdir(parents=True, exist_ok=True)
            self.write_json(group_dir / "group.json", group)
            self.write_json(
                group_dir / "summary.json",
                {
                    "groupId": group.group_id,
                    "label": group.label,
                    "caseCount": len(group.cases),
                    "createdAt": datetime.now(timezone.utc),
                },
            )

            for case in group.cases:
                case_dir = self.case_dir(run_definition.run_id, group.group_id, case.case_id)
                for leaf in (
                    case_dir / "raw",
                    case_dir / "protocol",
                    case_dir / "render",
                    case_dir / "device",
                    case_dir / "artifacts",
                ):
                    leaf.mkdir(parents=True, exist_ok=True)

                self.write_json(case_dir / "case.json", case)
                self.write_json(case_dir / "protocol.json", self.protocol_snapshot(case))
                self.write_json(
                    case_dir / "status.json",
                    {
                        "runId": run_definition.run_id,
                        "groupId": group.group_id,
                        "caseId": case.case_id,
                        "status": "queued",
                        "updatedAt": datetime.now(timezone.utc),
                    },
                )
                self.write_json(case_dir / "annotations.json", {"labels": [], "notes": []})
                self.write_json(case_dir / "artifacts" / "manifest.json", {"artifacts": {}})
                self.write_json(case_dir / "artifacts" / "timeline.json", {"events": []})

        self.rebuild_indexes()
        return run_dir

    def case_dir(self, run_id: str, group_id: str, case_id: str) -> Path:
        return self.run_dir(run_id) / "groups" / group_id / "cases" / case_id

    def append_event(self, event: StudioEvent) -> None:
        """Append a single event to the run event stream."""

        events_path = self.run_dir(event.run_id) / "events.jsonl"
        with events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(to_jsonable(event), ensure_ascii=False) + "\n")

    def write_execution_metadata(
        self,
        run_id: str,
        execution_id: str,
        provider: str,
        *,
        pid: int | None = None,
        started_at: datetime | None = None,
    ) -> None:
        """Persist metadata for the currently active runner process."""

        execution_path = self.run_dir(run_id) / "execution.json"
        current: dict[str, Any] = {}
        if execution_path.exists():
            try:
                current = self.read_json(execution_path)
            except Exception:
                current = {}

        payload = {
            **current,
            "executionId": execution_id,
            "provider": provider,
            "startedAt": started_at or datetime.now(timezone.utc),
        }
        if pid is not None:
            payload["pid"] = pid

        self.write_json(execution_path, payload)

    def prepare_for_execution(
        self,
        run_definition: StudioRunDefinition,
        provider: str,
        execution_id: str | None = None,
    ) -> None:
        """Reset per-execution artifacts so reruns only surface the latest attempt."""

        run_dir = self.run_dir(run_definition.run_id)
        execution_id = execution_id or f"exec-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
        started_at = datetime.now(timezone.utc)

        summary_path = run_dir / "summary.json"
        history = []
        if summary_path.exists():
            try:
                existing_summary = self.read_json(summary_path)
                history = existing_summary.get("history", [])
                if not history:
                    legacy_exec_id = None
                    if existing_summary.get("metadata", {}).get("latest_execution_id"):
                        candidate = existing_summary["metadata"]["latest_execution_id"]
                        if candidate != execution_id:
                            legacy_exec_id = candidate
                    
                    if not legacy_exec_id:
                        exec_json_path = run_dir / "execution.json"
                        if exec_json_path.exists():
                            try:
                                exec_meta = self.read_json(exec_json_path)
                                candidate = exec_meta.get("executionId")
                                if candidate and candidate != execution_id:
                                    legacy_exec_id = candidate
                            except Exception:
                                pass

                    if legacy_exec_id:
                        legacy_provider = existing_summary.get("metadata", {}).get("completion_provider", "unknown")
                        legacy_started_at = existing_summary.get("metadata", {}).get("latest_execution_started_at")
                        
                        legacy_model = existing_summary.get("model", "")
                        if legacy_provider and ":" in legacy_provider:
                            legacy_model = legacy_provider.split(":", 1)[1]
                        elif legacy_provider in ("mock", "static"):
                            legacy_model = legacy_provider

                        history.append({
                            "execution_id": legacy_exec_id,
                            "version": "v1",
                            "model": legacy_model,
                            "provider": legacy_provider,
                            "started_at": legacy_started_at or existing_summary.get("created_at"),
                            "status": existing_summary.get("status", "completed"),
                            "completed_cases": existing_summary.get("completed_cases", 0),
                            "failed_cases": existing_summary.get("failed_cases", 0),
                            "group_names": [g.group_id for g in run_definition.groups],
                        })
            except Exception:
                pass

        # Check if the execution_id already exists in history to prevent duplicates
        existing_idx = -1
        for i, entry in enumerate(history):
            if entry.get("execution_id") == execution_id:
                existing_idx = i
                break

        # Determine the model name for this execution
        model_name = run_definition.model
        if provider and ":" in provider:
            model_name = provider.split(":", 1)[1]
        elif provider in ("mock", "static"):
            model_name = provider

        print(
            f"[StudioStorage] prepare_for_execution: run_id={run_definition.run_id}, "
            f"execution_id={execution_id}, provider={provider}, parsed_model={model_name}",
            flush=True,
        )

        if existing_idx >= 0:
            # Update the existing entry's properties
            history[existing_idx]["status"] = "preparing"
            history[existing_idx]["completed_cases"] = 0
            history[existing_idx]["failed_cases"] = 0
            history[existing_idx]["started_at"] = started_at
            history[existing_idx]["provider"] = provider
            history[existing_idx]["model"] = model_name
        else:
            version_num = len(history) + 1
            version_name = f"v{version_num}"
            group_names = [g.group_id for g in run_definition.groups]
            history.append({
                "execution_id": execution_id,
                "version": version_name,
                "model": model_name,
                "provider": provider,
                "started_at": started_at,
                "status": "preparing",
                "completed_cases": 0,
                "failed_cases": 0,
                "group_names": group_names,
            })

        run_definition.metadata = {
            **run_definition.metadata,
            "completion_provider": provider,
            "latest_execution_id": execution_id,
            "latest_execution_started_at": started_at,
        }
        self.write_execution_metadata(
            run_definition.run_id,
            execution_id,
            provider,
            started_at=started_at,
        )

        for group in run_definition.groups:
            for case in group.cases:
                case_dir = self.execution_case_dir(run_definition.run_id, execution_id, group.group_id, case.case_id)
                for leaf in (
                    case_dir / "raw",
                    case_dir / "protocol",
                    case_dir / "render",
                    case_dir / "device",
                    case_dir / "artifacts",
                ):
                    leaf.mkdir(parents=True, exist_ok=True)

                self.write_json(
                    case_dir / "status.json",
                    {
                        "runId": run_definition.run_id,
                        "groupId": group.group_id,
                        "caseId": case.case_id,
                        "status": "queued",
                        "updatedAt": datetime.now(timezone.utc),
                        "error": None,
                        "metadata": {},
                    },
                )
                self.write_json(case_dir / "artifacts" / "manifest.json", {"artifacts": {}})
                self.write_json(case_dir / "artifacts" / "timeline.json", {"events": []})

        self.write_json(run_dir / "run.json", run_definition)
        
        summary = self.build_summary(run_definition)
        summary.history = history
        summary.status = StudioRunStatus.PREPARING
        
        self.write_json(summary_path, summary)

        self.append_event(
            StudioEvent(
                event_type="run.execution_started",
                run_id=run_definition.run_id,
                payload={
                    "name": run_definition.name,
                    "executionMode": run_definition.execution_mode,
                    "groupIds": [group.group_id for group in run_definition.groups],
                    "completionProvider": provider,
                    "executionId": execution_id,
                },
            )
        )
        self.rebuild_indexes()

    def write_case_result(self, result: StudioCaseResult) -> None:
        """Persist normalized result artifacts and materialized status."""

        execution_id = self.get_latest_execution_id(result.run_id)
        if execution_id:
            case_dir = self.execution_case_dir(result.run_id, execution_id, result.group_id, result.case_id)
        else:
            case_dir = self.case_dir(result.run_id, result.group_id, result.case_id)
            
        raw_dir = case_dir / "raw"
        protocol_dir = case_dir / "protocol"
        render_dir = case_dir / "render"
        artifacts_dir = case_dir / "artifacts"

        for leaf in (raw_dir, protocol_dir, render_dir, artifacts_dir):
            leaf.mkdir(parents=True, exist_ok=True)

        if result.raw_completion is not None:
            self.write_text(raw_dir / "raw_completion.md", result.raw_completion)
        self.write_json(protocol_dir / "parsed.json", result.parsed_messages)
        self.write_json(protocol_dir / "normalized.json", result.normalized_messages)
        self.write_json(protocol_dir / "validation.json", result.validation)
        self.write_json(protocol_dir / "semantic_eval.json", result.semantic_evaluation)
        self.write_json(case_dir / "protocol.json", self.protocol_snapshot(result))
        self.write_json(render_dir / "replay.json", result.normalized_messages)

        manifest = {
            "artifacts": {
                StudioArtifactKind.RAW_COMPLETION.value: "raw/raw_completion.md",
                StudioArtifactKind.PARSED_MESSAGES.value: "protocol/parsed.json",
                StudioArtifactKind.NORMALIZED_MESSAGES.value: "protocol/normalized.json",
                StudioArtifactKind.VALIDATION.value: "protocol/validation.json",
                StudioArtifactKind.SEMANTIC_EVAL.value: "protocol/semantic_eval.json",
                StudioArtifactKind.RENDER_REPLAY.value: "render/replay.json",
            }
        }
        self.write_json(artifacts_dir / "manifest.json", manifest)

        # Construct and populate timeline.json events
        timeline_events = []
        now = datetime.now(timezone.utc).isoformat()

        # 1. Completion received
        has_completion = result.raw_completion is not None
        timeline_events.append({
            "event": "completion_received",
            "timestamp": now,
            "payload": {
                "success": has_completion,
                "length": len(result.raw_completion) if has_completion else 0
            }
        })

        # 2. Parsed
        has_parsed = len(result.parsed_messages) > 0
        timeline_events.append({
            "event": "parsed",
            "timestamp": now,
            "payload": {
                "success": has_parsed,
                "message_count": len(result.parsed_messages)
            }
        })

        # 3. Validated
        val_pass = result.validation.get("pass", False)
        timeline_events.append({
            "event": "validated",
            "timestamp": now,
            "payload": {
                "pass": val_pass,
                "errors_count": len(result.validation.get("errors", [])),
                "issues_categories": [issue.get("category") for issue in result.validation.get("issues", [])]
            }
        })

        # 4. Scored
        score_pass = result.semantic_evaluation.get("pass", False)
        grade = result.semantic_evaluation.get("grade")
        timeline_events.append({
            "event": "scored",
            "timestamp": now,
            "payload": {
                "pass": score_pass,
                "grade": grade
            }
        })

        self.write_json(artifacts_dir / "timeline.json", {"events": timeline_events})

        self.write_json(
            case_dir / "status.json",
            {
                "runId": result.run_id,
                "groupId": result.group_id,
                "caseId": result.case_id,
                "status": result.status,
                "updatedAt": datetime.now(timezone.utc),
                "error": result.error,
                "metadata": result.metadata,
            },
        )
        self.write_json(case_dir / "result.json", result)
        self.rebuild_indexes()

    def build_summary(self, run_definition: StudioRunDefinition) -> StudioRunSummary:
        """Create an initial run summary for newly created runs."""

        total_cases = sum(len(group.cases) for group in run_definition.groups)

        # Load existing history from disk if summary.json already exists
        history = []
        summary_path = self.run_dir(run_definition.run_id) / "summary.json"
        if summary_path.exists():
            try:
                existing = self.read_json(summary_path)
                history = existing.get("history", [])
            except Exception:
                pass

        return StudioRunSummary(
            run_id=run_definition.run_id,
            name=run_definition.name,
            created_at=run_definition.created_at,
            status=run_definition.metadata.get("status", "queued"),
            model=run_definition.model,
            grading_model=run_definition.grading_model,
            execution_mode=run_definition.execution_mode,
            total_cases=total_cases,
            completed_cases=0,
            failed_cases=0,
            group_ids=[group.group_id for group in run_definition.groups],
            renderer=run_definition.renderer,
            protocol_id=run_definition.protocol_id,
            protocol_version=run_definition.protocol_version,
            protocol_profile_id=run_definition.protocol_profile_id,
            protocol_options=run_definition.protocol_options,
            spec_version=run_definition.spec_version,
            catalog_profile_id=run_definition.catalog_profile_id,
            metadata=run_definition.metadata,
            history=history,
        )

    def update_run_summary(self, summary: StudioRunSummary) -> None:
        """Persist a run summary and refresh indexes."""

        self.write_json(self.run_dir(summary.run_id) / "summary.json", summary)
        self.rebuild_indexes()

    def summarize_case_statuses(self, run_id: str, execution_id: str | None = None) -> tuple[int, int, dict[str, int]]:
        """Recompute run case counts from persisted case statuses."""

        status_counts: dict[str, int] = {}
        completed_cases = 0
        failed_cases = 0

        if execution_id:
            status_glob = f"executions/{execution_id}/groups/*/cases/*/status.json"
        else:
            status_glob = "groups/*/cases/*/status.json"

        for status_path in sorted(self.run_dir(run_id).glob(status_glob)):
            status_data = self.read_json(status_path)
            status = status_data.get("status")
            if not status:
                continue

            status_counts[status] = status_counts.get(status, 0) + 1
            if status == StudioRunStatus.COMPLETED.value:
                completed_cases += 1
            elif status not in {
                StudioRunStatus.QUEUED.value,
                StudioRunStatus.PREPARING.value,
                StudioRunStatus.RUNNING_PROTOCOL.value,
                StudioRunStatus.RUNNING_RENDER.value,
                StudioRunStatus.COLLECTING_DEVICE.value,
            }:
                failed_cases += 1

        return completed_cases, failed_cases, status_counts

    def refresh_run_summary_from_cases(
        self,
        summary: StudioRunSummary,
        *,
        status: StudioRunStatus | None = None,
        latest_error: str | None = None,
    ) -> StudioRunSummary:
        """Persist summary counts recomputed from materialized case statuses."""

        latest_execution_id = summary.metadata.get("latest_execution_id")
        completed_cases, failed_cases, _ = self.summarize_case_statuses(summary.run_id, latest_execution_id)
        summary.completed_cases = completed_cases
        summary.failed_cases = failed_cases
        if status is not None:
            summary.status = status
        if latest_error is not None:
            summary.latest_error = latest_error

        if latest_execution_id and hasattr(summary, "history") and summary.history:
            for entry in summary.history:
                if entry.get("execution_id") == latest_execution_id:
                    entry["completed_cases"] = completed_cases
                    entry["failed_cases"] = failed_cases
                    entry["status"] = summary.status.value if isinstance(summary.status, Enum) else summary.status
                    break

        self.update_run_summary(summary)
        return summary

    def update_case_status(
        self,
        run_id: str,
        group_id: str,
        case_id: str,
        status: str,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Persist a lightweight case status update for in-flight WebUI polling."""

        execution_id = self.get_latest_execution_id(run_id)
        if execution_id:
            case_dir = self.execution_case_dir(run_id, execution_id, group_id, case_id)
        else:
            case_dir = self.case_dir(run_id, group_id, case_id)

        case_dir.mkdir(parents=True, exist_ok=True)
        self.write_json(
            case_dir / "status.json",
            {
                "runId": run_id,
                "groupId": group_id,
                "caseId": case_id,
                "status": status,
                "updatedAt": datetime.now(timezone.utc),
                "error": error,
                "metadata": metadata or {},
            },
        )
        self.rebuild_indexes()

    def rebuild_indexes(self) -> None:
        """Recompute lightweight indexes from run summaries."""

        self.ensure_root()
        runs_index: list[dict[str, Any]] = []
        groups_index: list[dict[str, Any]] = []
        cases_index: list[dict[str, Any]] = []

        for summary_path in sorted(self.runs_dir.glob("*/summary.json")):
            summary_data = json.loads(summary_path.read_text(encoding="utf-8"))
            run_dir = summary_path.parent
            run_id = run_dir.name
            latest_execution_id = summary_data.get("metadata", {}).get("latest_execution_id")

            # Recompute actual counts from materialized case statuses on disk
            completed_cases, failed_cases, _ = self.summarize_case_statuses(run_id, latest_execution_id)

            active_statuses = {
                StudioRunStatus.QUEUED.value,
                StudioRunStatus.PREPARING.value,
                StudioRunStatus.RUNNING_PROTOCOL.value,
                StudioRunStatus.RUNNING_RENDER.value,
                StudioRunStatus.COLLECTING_DEVICE.value,
            }
            current_status = summary_data.get("status")

            changed = False

            if summary_data.get("completed_cases") != completed_cases:
                summary_data["completed_cases"] = completed_cases
                changed = True

            if summary_data.get("failed_cases") != failed_cases:
                summary_data["failed_cases"] = failed_cases
                changed = True

            # If the run is in a final status, ensure it matches the actual case results
            if current_status not in active_statuses:
                total_cases = summary_data.get("total_cases", 0)
                if total_cases > 0 and completed_cases + failed_cases == total_cases:
                    new_status = StudioRunStatus.COMPLETED.value if failed_cases == 0 else StudioRunStatus.FAILED_PROTOCOL.value
                    if current_status == StudioRunStatus.ERROR_INFRASTRUCTURE.value:
                        new_status = StudioRunStatus.ERROR_INFRASTRUCTURE.value
                    if current_status != new_status:
                        summary_data["status"] = new_status
                        changed = True

            if changed:
                try:
                    summary_path.write_text(
                        json.dumps(summary_data, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8",
                    )
                except Exception as e:
                    print(f"Warning: failed to write updated summary for {run_id}: {e}")

            runs_index.append(summary_data)

            for group_path in sorted(run_dir.glob("groups/*/group.json")):
                group_data = json.loads(group_path.read_text(encoding="utf-8"))
                group_id = group_data["group_id"]
                groups_index.append(
                    {
                        "runId": run_id,
                        "groupId": group_id,
                        "label": group_data.get("label", group_id),
                        "caseCount": len(group_data.get("cases", [])),
                    }
                )

                for case_path in sorted(group_path.parent.glob("cases/*/case.json")):
                    case_data = json.loads(case_path.read_text(encoding="utf-8"))
                    case_id = case_data["case_id"]
                    status = None
                    
                    status_path = None
                    if latest_execution_id:
                        status_path = run_dir / "executions" / latest_execution_id / "groups" / group_id / "cases" / case_id / "status.json"
                    
                    if not status_path or not status_path.exists():
                        status_path = case_path.parent / "status.json"
                        
                    if status_path.exists():
                        try:
                            status = json.loads(status_path.read_text(encoding="utf-8")).get("status")
                        except Exception:
                            pass
                    
                    annotations_path = case_path.parent / "annotations.json"
                    annotation_count = 0
                    annotation_labels = []
                    if annotations_path.exists():
                        try:
                            ann_data = json.loads(annotations_path.read_text(encoding="utf-8"))
                            annotation_count = len(ann_data.get("labels", [])) + len(ann_data.get("notes", []))
                            annotation_labels = [l.get("value") for l in ann_data.get("labels", []) if l.get("value")]
                        except Exception:
                            pass

                    cases_index.append(
                        {
                            "runId": run_id,
                            "groupId": group_id,
                            "caseId": case_data["case_id"],
                            "prompt": case_data.get("prompt", ""),
                            "status": status,
                            "renderer": case_data.get("renderer"),
                            "protocolId": case_data.get("protocol_id", "a2ui"),
                            "protocolVersion": case_data.get("protocol_version", case_data.get("spec_version")),
                            "protocolProfileId": case_data.get("protocol_profile_id"),
                            "specVersion": case_data.get("spec_version"),
                            "catalogProfileId": case_data.get("catalog_profile_id"),
                            "annotationCount": annotation_count,
                            "annotationLabels": annotation_labels,
                        }
                    )

        self.write_json(self.indexes_dir / "runs.json", runs_index)
        self.write_json(self.indexes_dir / "groups.json", groups_index)
        self.write_json(self.indexes_dir / "cases.json", cases_index)

    def protocol_snapshot(self, source: Any) -> dict[str, Any]:
        """Return the persisted protocol identity for a run, case, or result."""

        return {
            "protocolId": getattr(source, "protocol_id", "a2ui"),
            "protocolVersion": getattr(
                source,
                "protocol_version",
                getattr(source, "spec_version", "0.9"),
            ),
            "protocolProfileId": getattr(source, "protocol_profile_id", None),
            "adapterId": (
                f"genui_eval.protocols.{getattr(source, 'protocol_id', 'a2ui')}"
            ),
            "protocolOptions": getattr(source, "protocol_options", {}),
            "provenance": {},
        }

    def case_annotations_path(self, run_id: str, group_id: str, case_id: str) -> Path:
        return self.case_dir(run_id, group_id, case_id) / "annotations.json"

    def read_annotations(self, run_id: str, group_id: str, case_id: str) -> dict[str, Any]:
        """Read manual annotations for a specific case."""
        path = self.case_annotations_path(run_id, group_id, case_id)
        if not path.exists():
            return {"labels": [], "notes": []}
        try:
            return self.read_json(path)
        except Exception:
            return {"labels": [], "notes": []}

    def write_annotation(
        self, run_id: str, group_id: str, case_id: str, annotation: StudioAnnotation
    ) -> None:
        """Persist or append a single manual annotation to a case."""
        path = self.case_annotations_path(run_id, group_id, case_id)
        current = self.read_annotations(run_id, group_id, case_id)
        
        anno_data = to_jsonable(annotation)
        
        if annotation.type == StudioAnnotationType.LABEL:
            # Overwrite label by the same author to prevent duplicating multiple status selections
            current["labels"] = [l for l in current.get("labels", []) if l.get("author") != annotation.author]
            current["labels"].append(anno_data)
        elif annotation.type == StudioAnnotationType.NOTE:
            current["notes"] = current.get("notes", [])
            current["notes"].append(anno_data)
        else:
            key = annotation.type.value
            current[key] = current.get(key, [])
            current[key].append(anno_data)
            
        self.write_json(path, current)
        self.rebuild_indexes()

    def read_json(self, path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))

    def write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f".{os.getpid()}.tmp")
        try:
            tmp_path.write_text(
                json.dumps(to_jsonable(payload), indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            tmp_path.replace(path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise

    def write_text(self, path: Path, contents: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f".{os.getpid()}.tmp")
        try:
            tmp_path.write_text(contents, encoding="utf-8")
            tmp_path.replace(path)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink()
            raise
