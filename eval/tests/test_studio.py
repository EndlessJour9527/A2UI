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

"""Unit tests for Eval Studio filesystem storage and orchestration."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from a2ui_eval.studio_adapter import ProtocolEvalAdapter
from a2ui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from a2ui_eval.studio_storage import StudioStorage
from a2ui_eval.studio_types import StudioCaseSelection, StudioGroupSelection, StudioExecutionMode

CATALOG_PATH = (
    Path(__file__).resolve().parents[2]
    / "specification"
    / "v0_9"
    / "catalogs"
    / "basic"
    / "catalog.json"
)

VALID_COMPLETION = """<a2ui-json>
[
  {
    \"version\": \"v0.9\",
    \"createSurface\": {
      \"surfaceId\": \"main\",
      \"catalogId\": \"https://a2ui.org/specification/v0_9/basic_catalog.json\"
    }
  },
  {
    \"version\": \"v0.9\",
    \"updateComponents\": {
      \"surfaceId\": \"main\",
      \"components\": [
        {
          \"id\": \"root\",
          \"component\": \"Text\",
          \"text\": \"Hello\",
          \"variant\": \"body\"
        }
      ]
    }
  }
]
</a2ui-json>"""


def build_run_definition(tmp_path: Path):
    groups = [
        StudioGroupSelection(
            group_id="group-a",
            label="Group A",
            cases=[
                StudioCaseSelection(
                    case_id="case-1",
                    group_id="group-a",
                    prompt="Render hello world",
                    target="hello",
                )
            ],
        )
    ]

    run_definition = create_run_definition(
        run_id="run-test-123",
        name="Test Run",
        groups=groups,
        model="test-model",
        grading_model="judge-model",
        execution_mode=StudioExecutionMode.SERIAL,
    )
    run_definition.storage_root = tmp_path / ".a2ui-eval-studio"
    run_definition.created_at = datetime.now(timezone.utc)
    return run_definition


def test_studio_storage_initializes_run_structure(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = StudioOrchestrator(storage, ProtocolEvalAdapter(CATALOG_PATH))

    plan = orchestrator.initialize_run(run_definition)
    run_dir = run_definition.storage_root / "runs" / run_definition.run_id

    assert (run_dir / "run.json").exists()
    assert (run_dir / "plan.json").exists()
    assert (run_dir / "summary.json").exists()
    assert (run_dir / "events.jsonl").exists()
    assert plan.case_attempts[0]["caseId"] == "case-1"

    case_dir = run_dir / "groups" / "group-a" / "cases" / "case-1"
    assert (case_dir / "protocol").exists()
    assert (case_dir / "render").exists()
    assert (case_dir / "device").exists()
    assert (case_dir / "artifacts" / "manifest.json").exists()


def test_protocol_adapter_evaluates_valid_completion():
    adapter = ProtocolEvalAdapter(CATALOG_PATH)
    selection = StudioCaseSelection(case_id="case-1", group_id="group-a", prompt="Render hello")

    result = adapter.evaluate_case("run-1", selection, VALID_COMPLETION)

    assert result.status.value == "completed"
    assert result.validation["pass"] is True
    assert len(result.parsed_messages) == 2


def test_orchestrator_run_persists_indexes_and_result(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = StudioOrchestrator(storage, ProtocolEvalAdapter(CATALOG_PATH))

    orchestrator.run(run_definition, completion_provider=lambda _: VALID_COMPLETION)

    runs_index_path = run_definition.storage_root / "indexes" / "runs.json"
    cases_index_path = run_definition.storage_root / "indexes" / "cases.json"
    summary_path = run_definition.storage_root / "runs" / run_definition.run_id / "summary.json"

    runs_index = json.loads(runs_index_path.read_text(encoding="utf-8"))
    cases_index = json.loads(cases_index_path.read_text(encoding="utf-8"))
    summary = json.loads(summary_path.read_text(encoding="utf-8"))

    assert runs_index[0]["run_id"] == run_definition.run_id
    assert cases_index[0]["caseId"] == "case-1"
    assert summary["completed_cases"] == 1
    assert summary["failed_cases"] == 0


def test_catalog_registry_resolution(tmp_path: Path):
    from a2ui_eval.catalog_registry import CatalogRegistry
    repo_root = Path(__file__).resolve().parents[2]
    registry = CatalogRegistry(tmp_path / ".a2ui-eval-studio", repo_root)
    registry.ensure_seeded()
    registry.load()

    profile = registry.get_profile("a2ui-basic-v0_9")
    assert profile is not None
    assert profile.profile_id == "a2ui-basic-v0_9"
    assert profile.catalog_id == "https://a2ui.org/specification/v0_9/basic_catalog.json"

    resolved = registry.resolve_profile("a2ui-basic-v0_9")
    assert resolved.profile_id == "a2ui-basic-v0_9"
    assert resolved.catalog_schema is not None

