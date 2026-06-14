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

"""Shared data models for Eval Studio MVP."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class StudioExecutionMode(str, Enum):
    """Supported execution modes for MVP orchestration."""

    SERIAL = "serial"
    PARALLEL = "parallel"


class StudioRunStatus(str, Enum):
    """Run and case status values surfaced to the UI."""

    QUEUED = "queued"
    PREPARING = "preparing"
    RUNNING_PROTOCOL = "running_protocol"
    RUNNING_RENDER = "running_render"
    COLLECTING_DEVICE = "collecting_device"
    COMPLETED = "completed"
    FAILED_PROTOCOL = "failed_protocol"
    FAILED_SEMANTIC = "failed_semantic"
    FAILED_RENDER = "failed_render"
    FAILED_DEVICE_CAPTURE = "failed_device_capture"
    ERROR_INFRASTRUCTURE = "error_infrastructure"
    CANCELED = "canceled"


class StudioArtifactKind(str, Enum):
    """Artifact kinds persisted in a case manifest."""

    PROMPT = "protocol.prompt"
    CONTEXT = "protocol.context"
    RAW_COMPLETION = "raw.raw_completion"
    PARSED_MESSAGES = "protocol.parsed"
    NORMALIZED_MESSAGES = "protocol.normalized"
    VALIDATION = "protocol.validation"
    SEMANTIC_EVAL = "protocol.semantic_eval"
    RENDER_REPLAY = "render.replay"
    RENDER_SCREENSHOT = "render.screenshot"


@dataclass(slots=True)
class StudioCaseSelection:
    """Single case selected for a run."""

    case_id: str
    prompt: str
    group_id: str = "default"
    description: str | None = None
    context: str | None = None
    target: str | None = None
    protocol_id: str = "a2ui"
    protocol_version: str = "0.9"
    protocol_profile_id: str | None = None
    protocol_options: dict[str, Any] = field(default_factory=dict)
    spec_version: str = "0.9"
    renderer: str = "react"
    catalog_id: str | None = None
    catalog_profile_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StudioGroupSelection:
    """Selected group and its cases."""

    group_id: str
    label: str
    cases: list[StudioCaseSelection]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StudioRunDefinition:
    """Top-level input used to create a run plan."""

    run_id: str
    name: str
    created_at: datetime
    groups: list[StudioGroupSelection]
    model: str
    grading_model: str
    execution_mode: StudioExecutionMode = StudioExecutionMode.SERIAL
    max_parallelism: int = 1
    repeat_count: int = 1
    renderer: str = "react"
    protocol_id: str = "a2ui"
    protocol_version: str = "0.9"
    protocol_profile_id: str | None = None
    protocol_options: dict[str, Any] = field(default_factory=dict)
    spec_version: str = "0.9"
    catalog_profile_id: str | None = None
    storage_root: Path | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StudioRunPlan:
    """Expanded plan emitted by the orchestrator before execution."""

    run: StudioRunDefinition
    case_attempts: list[dict[str, Any]]


@dataclass(slots=True)
class StudioCaseResult:
    """Normalized, UI-friendly result for one case attempt."""

    run_id: str
    group_id: str
    case_id: str
    status: StudioRunStatus
    prompt: str
    raw_completion: str | None = None
    parsed_messages: list[Any] = field(default_factory=list)
    normalized_messages: list[Any] = field(default_factory=list)
    validation: dict[str, Any] = field(default_factory=dict)
    semantic_evaluation: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, str] = field(default_factory=dict)
    renderer: str = "react"
    protocol_id: str = "a2ui"
    protocol_version: str = "0.9"
    protocol_profile_id: str | None = None
    protocol_options: dict[str, Any] = field(default_factory=dict)
    spec_version: str = "0.9"
    catalog_profile_id: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StudioEvent:
    """Append-only event entry persisted to events.jsonl."""

    event_type: str
    run_id: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StudioRunSummary:
    """Materialized run summary for fast UI loading."""

    run_id: str
    name: str
    created_at: datetime
    status: StudioRunStatus
    model: str
    grading_model: str
    execution_mode: StudioExecutionMode
    total_cases: int
    completed_cases: int
    failed_cases: int
    group_ids: list[str]
    renderer: str
    protocol_id: str
    protocol_version: str
    protocol_profile_id: str | None = None
    protocol_options: dict[str, Any] = field(default_factory=dict)
    spec_version: str = "0.9"
    catalog_profile_id: str | None = None
    latest_error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)


class StudioAnnotationType(str, Enum):
    """Supported annotation types."""

    LABEL = "label"
    NOTE = "note"
    DISPOSITION = "disposition"
    SCORE = "score"


class StudioLabel(str, Enum):
    """Standard taxonomy labels for evaluation."""

    CORRECT = "correct"
    INCORRECT = "incorrect"
    PARTIAL = "partial"
    HALLUCINATION = "hallucination"
    RENDERING_ISSUE = "rendering_issue"
    PROMPT_ISSUE = "prompt_issue"
    NEEDS_REVIEW = "needs_review"


@dataclass(slots=True)
class StudioAnnotation:
    """Structure representing a single manual or automated case annotation."""

    annotation_id: str
    created_at: datetime
    author: str
    type: StudioAnnotationType
    value: str
    confidence: float = 1.0
    source: str = "manual"
    metadata: dict[str, Any] = field(default_factory=dict)


class PlanningError(Exception):
    """Exception raised for incompatible catalog configs or planning validation errors."""

    def __init__(self, message: str, errors: list[str] = None):
        super().__init__(message)
        self.errors = errors or [message]


def to_jsonable(value: Any) -> Any:
    """Convert studio dataclasses/enums/datetimes into JSON-safe values."""

    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "__dataclass_fields__"):
        return {key: to_jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value
