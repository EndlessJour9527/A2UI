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

"""Run orchestration skeleton for Eval Studio MVP."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

from .catalog_registry import CatalogRegistry, ResolvedCatalogConfig
from .studio_adapter import ProtocolEvalAdapter
from .studio_storage import StudioStorage, build_default_studio_root
from .studio_types import (
    StudioCaseSelection,
    StudioEvent,
    StudioExecutionMode,
    StudioRunDefinition,
    StudioRunPlan,
    StudioRunStatus,
)

CompletionProvider = Callable[[StudioCaseSelection], str]


class StudioOrchestrator:
    """Create runs, persist artifacts, and execute simple MVP case loops."""

    def __init__(
        self,
        storage: StudioStorage,
        protocol_adapter: ProtocolEvalAdapter,
        registry: CatalogRegistry | None = None,
    ):
        self.storage = storage
        self.protocol_adapter = protocol_adapter
        self.registry = registry
        self._adapter_cache: dict[str, ProtocolEvalAdapter] = {}

    @classmethod
    def for_repo(cls, eval_root: Path, catalog_path: Path | None = None) -> "StudioOrchestrator":
        repo_root = eval_root.parent if eval_root.name == "eval" else eval_root
        studio_root = build_default_studio_root(eval_root)
        storage = StudioStorage(studio_root)

        registry = CatalogRegistry(studio_root, repo_root)
        registry.load()

        if catalog_path is not None:
            adapter = ProtocolEvalAdapter(catalog_path=catalog_path)
        else:
            default_config = registry.resolve_profile(registry.default_profile_id)
            adapter = ProtocolEvalAdapter(resolved_config=default_config)

        return cls(storage=storage, protocol_adapter=adapter, registry=registry)

    def build_plan(self, run_definition: StudioRunDefinition) -> StudioRunPlan:
        """Expand a run definition into ordered case attempts."""

        attempts: list[dict[str, object]] = []
        for group in run_definition.groups:
            for repeat_index in range(run_definition.repeat_count):
                for case in group.cases:
                    attempts.append(
                        {
                            "groupId": group.group_id,
                            "caseId": case.case_id,
                            "attempt": repeat_index + 1,
                            "executionMode": run_definition.execution_mode.value,
                            "renderer": case.renderer,
                            "specVersion": case.spec_version,
                            "catalogProfileId": case.catalog_profile_id or run_definition.catalog_profile_id,
                        }
                    )
        return StudioRunPlan(run=run_definition, case_attempts=attempts)

    def initialize_run(self, run_definition: StudioRunDefinition) -> StudioRunPlan:
        """Create storage structure and initial events for a run."""

        plan = self.build_plan(run_definition)
        self.storage.initialize_run(run_definition, plan)
        self.storage.append_event(
            StudioEvent(
                event_type="run.created",
                run_id=run_definition.run_id,
                payload={
                    "name": run_definition.name,
                    "executionMode": run_definition.execution_mode.value,
                    "groupIds": [group.group_id for group in run_definition.groups],
                },
            )
        )
        return plan

    def run(
        self,
        run_definition: StudioRunDefinition,
        completion_provider: CompletionProvider,
    ) -> StudioRunPlan:
        """Execute a simple synchronous MVP run using a provided completion source."""

        # Populate catalog profile for cases if not set
        for group in run_definition.groups:
            for case in group.cases:
                if not case.catalog_profile_id:
                    case.catalog_profile_id = run_definition.catalog_profile_id or (
                        self.registry.default_profile_id if self.registry else "a2ui-basic-v0_9"
                    )
                # Resolve catalog_id from profile if registry is present
                if self.registry and case.catalog_profile_id:
                    try:
                        profile = self.registry.get_profile(case.catalog_profile_id)
                        if profile:
                            case.catalog_id = profile.catalog_id
                    except Exception as e:
                        logger.warning(
                            "Failed to resolve catalog_id for profile %s: %s",
                            case.catalog_profile_id,
                            e,
                        )

        plan = self.initialize_run(run_definition)
        completed = 0
        failed = 0

        for group in run_definition.groups:
            self.storage.append_event(
                StudioEvent(
                    event_type="group.started",
                    run_id=run_definition.run_id,
                    payload={"groupId": group.group_id},
                )
            )

            for case in group.cases:
                self.storage.append_event(
                    StudioEvent(
                        event_type="case.started",
                        run_id=run_definition.run_id,
                        payload={"groupId": group.group_id, "caseId": case.case_id},
                    )
                )

                # Resolve specific adapter for the case
                case_adapter = self.protocol_adapter
                if self.registry and case.catalog_profile_id:
                    profile_id = case.catalog_profile_id
                    if profile_id not in self._adapter_cache:
                        try:
                            resolved = self.registry.resolve_profile(profile_id)
                            self._adapter_cache[profile_id] = ProtocolEvalAdapter(resolved_config=resolved)
                        except Exception as e:
                            logger.warning(
                                "Failed to initialize ProtocolEvalAdapter for profile %s: %s",
                                profile_id,
                                e,
                            )
                    case_adapter = self._adapter_cache.get(profile_id, self.protocol_adapter)

                completion = completion_provider(case)
                result = case_adapter.evaluate_case(
                    run_id=run_definition.run_id,
                    selection=case,
                    completion=completion,
                )
                self.storage.write_case_result(result)
                self.storage.append_event(
                    StudioEvent(
                        event_type="case.completed",
                        run_id=run_definition.run_id,
                        payload={
                            "groupId": group.group_id,
                            "caseId": case.case_id,
                            "status": result.status.value,
                        },
                    )
                )
                completed += 1
                if result.status != StudioRunStatus.COMPLETED:
                    failed += 1

        summary = self.storage.build_summary(run_definition)
        summary.completed_cases = completed
        summary.failed_cases = failed
        summary.status = (
            StudioRunStatus.COMPLETED if failed == 0 else StudioRunStatus.FAILED_PROTOCOL
        )
        self.storage.update_run_summary(summary)
        self.storage.append_event(
            StudioEvent(
                event_type="run.completed",
                run_id=run_definition.run_id,
                payload={
                    "completedCases": completed,
                    "failedCases": failed,
                    "status": summary.status.value,
                },
            )
        )
        return plan


def create_run_definition(
    run_id: str,
    name: str,
    groups,
    model: str,
    grading_model: str,
    execution_mode: StudioExecutionMode = StudioExecutionMode.SERIAL,
    max_parallelism: int = 1,
    repeat_count: int = 1,
    renderer: str = "react",
    spec_version: str = "0.9",
    catalog_profile_id: str | None = None,
) -> StudioRunDefinition:
    """Convenience helper for tests and API handlers."""

    return StudioRunDefinition(
        run_id=run_id,
        name=name,
        created_at=datetime.now(timezone.utc),
        groups=list(groups),
        model=model,
        grading_model=grading_model,
        execution_mode=execution_mode,
        max_parallelism=max_parallelism,
        repeat_count=repeat_count,
        renderer=renderer,
        spec_version=spec_version,
        catalog_profile_id=catalog_profile_id,
    )
