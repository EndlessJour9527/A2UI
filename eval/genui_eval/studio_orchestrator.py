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

from .protocols.registry import ProtocolRegistry
from .studio_storage import StudioStorage, build_default_studio_root
from .studio_types import (
    PlanningError,
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
        protocol_registry: ProtocolRegistry,
    ):
        self.storage = storage
        self.protocol_registry = protocol_registry

    @classmethod
    def for_repo(cls, eval_root: Path) -> "StudioOrchestrator":
        repo_root = eval_root.parent if eval_root.name == "eval" else eval_root
        studio_root = build_default_studio_root(eval_root)
        storage = StudioStorage(studio_root)

        protocol_registry = ProtocolRegistry(studio_root, repo_root)
        protocol_registry.load()
        return cls(storage=storage, protocol_registry=protocol_registry)

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
                            "protocolId": case.protocol_id or run_definition.protocol_id,
                            "protocolVersion": case.protocol_version or run_definition.protocol_version,
                            "protocolProfileId": (
                                case.protocol_profile_id
                                or run_definition.protocol_profile_id
                                or case.catalog_profile_id
                                or run_definition.catalog_profile_id
                            ),
                            "specVersion": case.spec_version,
                            "catalogProfileId": (
                                case.catalog_profile_id or run_definition.catalog_profile_id
                            ),
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

    def validate_compatibility(self, run_definition: StudioRunDefinition) -> None:
        """Validate run compatibility criteria before starting execution.

        Raises:
            PlanningError: If any of the compatibility criteria are violated.
        """
        errors = []

        for group in run_definition.groups:
            for case in group.cases:
                errors.extend(self.protocol_registry.validate_case(run_definition, case))

        if errors:
            raise PlanningError(f"Run compatibility validation failed with {len(errors)} error(s)", errors)

    def run(
        self,
        run_definition: StudioRunDefinition,
        completion_provider: CompletionProvider,
    ) -> StudioRunPlan:
        """Execute a simple synchronous MVP run using a provided completion source."""

        # Run pre-execution compatibility checks
        self.validate_compatibility(run_definition)

        # Populate protocol profile for cases if not set
        for group in run_definition.groups:
            for case in group.cases:
                config = self.protocol_registry.resolve_for_case(run_definition, case)
                case.protocol_id = config.protocol_id
                case.protocol_version = config.protocol_version
                case.protocol_profile_id = config.protocol_profile_id
                case.protocol_options = dict(config.protocol_options)
                case.spec_version = config.protocol_version

        plan = self.initialize_run(run_definition)
        summary = self.storage.build_summary(run_definition)
        summary.status = StudioRunStatus.RUNNING_PROTOCOL
        self.storage.update_run_summary(summary)

        for group in run_definition.groups:
            self.storage.append_event(
                StudioEvent(
                    event_type="group.started",
                    run_id=run_definition.run_id,
                    payload={"groupId": group.group_id},
                )
            )

            for case in group.cases:
                self.storage.update_case_status(
                    run_definition.run_id,
                    group.group_id,
                    case.case_id,
                    StudioRunStatus.RUNNING_PROTOCOL.value,
                )
                self.storage.append_event(
                    StudioEvent(
                        event_type="case.started",
                        run_id=run_definition.run_id,
                        payload={"groupId": group.group_id, "caseId": case.case_id},
                    )
                )

                completion = completion_provider(case)
                config = self.protocol_registry.resolve_for_case(run_definition, case)
                result = config.pack.evaluate_case(
                    run_id=run_definition.run_id,
                    selection=case,
                    completion=completion,
                    config=config,
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
                summary.status = StudioRunStatus.RUNNING_PROTOCOL
                self.storage.refresh_run_summary_from_cases(summary)

        summary.status = (
            StudioRunStatus.COMPLETED
            if summary.failed_cases == 0
            else StudioRunStatus.FAILED_PROTOCOL
        )
        self.storage.refresh_run_summary_from_cases(summary)
        self.storage.append_event(
            StudioEvent(
                event_type="run.completed",
                run_id=run_definition.run_id,
                payload={
                    "completedCases": summary.completed_cases,
                    "failedCases": summary.failed_cases,
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
    protocol_id: str = "a2ui",
    protocol_version: str = "0.9",
    protocol_profile_id: str | None = None,
    protocol_options: dict | None = None,
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
        protocol_id=protocol_id,
        protocol_version=protocol_version,
        protocol_profile_id=protocol_profile_id,
        protocol_options=protocol_options or {},
        spec_version=spec_version,
        catalog_profile_id=catalog_profile_id,
    )
