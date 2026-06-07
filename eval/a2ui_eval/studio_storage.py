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
    to_jsonable,
)


def build_default_studio_root(eval_root: Path | None = None) -> Path:
    """Return the repository-local Eval Studio root."""

    if eval_root is None:
        eval_root = Path(__file__).resolve().parents[2]
    if eval_root.name == "eval":
        eval_root = eval_root.parent
    return eval_root / ".a2ui-eval-studio"


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

    def initialize_run(self, run_definition: StudioRunDefinition, run_plan: StudioRunPlan) -> Path:
        """Create the canonical directory structure for a run."""

        self.ensure_root()
        run_dir = self.run_dir(run_definition.run_id)
        (run_dir / "groups").mkdir(parents=True, exist_ok=True)

        self.write_json(run_dir / "run.json", run_definition)
        self.write_json(run_dir / "plan.json", run_plan)
        self.write_json(run_dir / "summary.json", self.build_summary(run_definition))
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
                    case_dir / "protocol",
                    case_dir / "render",
                    case_dir / "device",
                    case_dir / "artifacts",
                ):
                    leaf.mkdir(parents=True, exist_ok=True)

                self.write_json(case_dir / "case.json", case)
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

    def write_case_result(self, result: StudioCaseResult) -> None:
        """Persist normalized result artifacts and materialized status."""

        case_dir = self.case_dir(result.run_id, result.group_id, result.case_id)
        protocol_dir = case_dir / "protocol"
        render_dir = case_dir / "render"
        artifacts_dir = case_dir / "artifacts"

        if result.raw_completion is not None:
            self.write_text(protocol_dir / "raw_completion.md", result.raw_completion)
        self.write_json(protocol_dir / "parsed_messages.json", result.parsed_messages)
        self.write_json(protocol_dir / "normalized_messages.json", result.normalized_messages)
        self.write_json(protocol_dir / "validation.json", result.validation)
        self.write_json(protocol_dir / "semantic_eval.json", result.semantic_evaluation)
        self.write_json(render_dir / "replay.json", result.normalized_messages)

        manifest = {
            "artifacts": {
                StudioArtifactKind.RAW_COMPLETION.value: "protocol/raw_completion.md",
                StudioArtifactKind.PARSED_MESSAGES.value: "protocol/parsed_messages.json",
                StudioArtifactKind.NORMALIZED_MESSAGES.value: "protocol/normalized_messages.json",
                StudioArtifactKind.VALIDATION.value: "protocol/validation.json",
                StudioArtifactKind.SEMANTIC_EVAL.value: "protocol/semantic_eval.json",
                StudioArtifactKind.RENDER_REPLAY.value: "render/replay.json",
            }
        }
        self.write_json(artifacts_dir / "manifest.json", manifest)
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
            spec_version=run_definition.spec_version,
            catalog_profile_id=run_definition.catalog_profile_id,
            metadata=run_definition.metadata,
        )

    def update_run_summary(self, summary: StudioRunSummary) -> None:
        """Persist a run summary and refresh indexes."""

        self.write_json(self.run_dir(summary.run_id) / "summary.json", summary)
        self.rebuild_indexes()

    def rebuild_indexes(self) -> None:
        """Recompute lightweight indexes from run summaries."""

        self.ensure_root()
        runs_index: list[dict[str, Any]] = []
        groups_index: list[dict[str, Any]] = []
        cases_index: list[dict[str, Any]] = []

        for summary_path in sorted(self.runs_dir.glob("*/summary.json")):
            summary_data = json.loads(summary_path.read_text(encoding="utf-8"))
            runs_index.append(summary_data)
            run_dir = summary_path.parent
            run_id = run_dir.name

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
                    status_path = case_path.parent / "status.json"
                    status = None
                    if status_path.exists():
                        status = json.loads(status_path.read_text(encoding="utf-8")).get("status")
                    cases_index.append(
                        {
                            "runId": run_id,
                            "groupId": group_id,
                            "caseId": case_data["case_id"],
                            "prompt": case_data.get("prompt", ""),
                            "status": status,
                            "renderer": case_data.get("renderer"),
                            "specVersion": case_data.get("spec_version"),
                            "catalogProfileId": case_data.get("catalog_profile_id"),
                        }
                    )

        self.write_json(self.indexes_dir / "runs.json", runs_index)
        self.write_json(self.indexes_dir / "groups.json", groups_index)
        self.write_json(self.indexes_dir / "cases.json", cases_index)

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
