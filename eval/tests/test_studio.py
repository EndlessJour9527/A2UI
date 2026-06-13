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

from genui_eval.protocols.a2ui.adapter import A2uiProtocolAdapter
from genui_eval.protocols.registry import ProtocolRegistry
from genui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from genui_eval.studio_storage import StudioStorage
from genui_eval.studio_types import (
    StudioCaseSelection,
    StudioGroupSelection,
    StudioExecutionMode,
    StudioAnnotation,
    StudioAnnotationType,
)

CATALOG_PATH = (
    Path(__file__).resolve().parents[2]
    / "specification"
    / "v0_9"
    / "catalogs"
    / "basic"
    / "catalog.json"
)


def build_protocol_registry(studio_root: Path) -> ProtocolRegistry:
    repo_root = Path(__file__).resolve().parents[2]
    registry = ProtocolRegistry(studio_root, repo_root)
    registry.load()
    return registry


def build_orchestrator(storage: StudioStorage) -> StudioOrchestrator:
    return StudioOrchestrator(storage, build_protocol_registry(storage.root))

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
    run_definition.storage_root = tmp_path / ".genui-eval-studio"
    run_definition.created_at = datetime.now(timezone.utc)
    return run_definition


def test_studio_storage_initializes_run_structure(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    plan = orchestrator.initialize_run(run_definition)
    run_dir = run_definition.storage_root / "runs" / run_definition.run_id

    assert (run_dir / "run.json").exists()
    assert (run_dir / "plan.json").exists()
    assert (run_dir / "summary.json").exists()
    assert (run_dir / "protocol.json").exists()
    assert (run_dir / "events.jsonl").exists()
    assert plan.case_attempts[0]["caseId"] == "case-1"

    case_dir = run_dir / "groups" / "group-a" / "cases" / "case-1"
    assert (case_dir / "protocol.json").exists()
    assert (case_dir / "raw").exists()
    assert (case_dir / "protocol").exists()
    assert (case_dir / "render").exists()
    assert (case_dir / "device").exists()
    assert (case_dir / "artifacts" / "manifest.json").exists()


def test_protocol_adapter_evaluates_valid_completion():
    adapter = A2uiProtocolAdapter(CATALOG_PATH)
    selection = StudioCaseSelection(case_id="case-1", group_id="group-a", prompt="Render hello")

    result = adapter.evaluate_case("run-1", selection, VALID_COMPLETION)

    assert result.status.value == "completed"
    assert result.validation["pass"] is True
    assert len(result.parsed_messages) == 2


def test_orchestrator_run_persists_indexes_and_result(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    orchestrator.run(run_definition, completion_provider=lambda _: VALID_COMPLETION)

    runs_index_path = run_definition.storage_root / "indexes" / "runs.json"
    cases_index_path = run_definition.storage_root / "indexes" / "cases.json"
    summary_path = run_definition.storage_root / "runs" / run_definition.run_id / "summary.json"
    case_dir = run_definition.storage_root / "runs" / run_definition.run_id / "groups" / "group-a" / "cases" / "case-1"

    runs_index = json.loads(runs_index_path.read_text(encoding="utf-8"))
    cases_index = json.loads(cases_index_path.read_text(encoding="utf-8"))
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    manifest = json.loads((case_dir / "artifacts" / "manifest.json").read_text(encoding="utf-8"))

    assert runs_index[0]["run_id"] == run_definition.run_id
    assert runs_index[0]["protocol_id"] == "a2ui"
    assert cases_index[0]["caseId"] == "case-1"
    assert cases_index[0]["protocolId"] == "a2ui"
    assert summary["completed_cases"] == 1
    assert summary["failed_cases"] == 0
    assert manifest["artifacts"]["raw.raw_completion"] == "raw/raw_completion.md"
    assert manifest["artifacts"]["protocol.parsed"] == "protocol/parsed.json"


def test_catalog_registry_resolution(tmp_path: Path):
    from genui_eval.protocols.a2ui.catalog_registry import CatalogRegistry
    repo_root = Path(__file__).resolve().parents[2]
    registry = CatalogRegistry(tmp_path / ".genui-eval-studio", repo_root)
    registry.ensure_seeded()
    registry.load()

    profile = registry.get_profile("a2ui-basic-v0_9")
    assert profile is not None
    assert profile.profile_id == "a2ui-basic-v0_9"
    assert profile.catalog_id == "https://a2ui.org/specification/v0_9/basic_catalog.json"

    resolved = registry.resolve_profile("a2ui-basic-v0_9")
    assert resolved.profile_id == "a2ui-basic-v0_9"
    assert resolved.catalog_schema is not None


def test_protocol_adapter_categorizes_errors():
    adapter = A2uiProtocolAdapter(CATALOG_PATH)
    selection = StudioCaseSelection(case_id="case-1", group_id="group-a", prompt="Render hello")

    # 1. No JSON
    res1 = adapter.evaluate_case("run-1", selection, "hello world")
    assert res1.status.value == "failed_protocol"
    assert res1.validation["pass"] is False
    assert res1.validation["issues"][0]["category"] == "schema_structure"
    assert res1.validation["issues"][0]["severity"] == "error"
    assert "Verify the format" in res1.validation["issues"][0]["suggestedFix"]

    # 2. Invalid schema (missing root or invalid component name)
    invalid_comp = """<a2ui-json>
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "NonExistentComponent"
        }
      ]
    }
  }
]
</a2ui-json>"""
    res2 = adapter.evaluate_case("run-1", selection, invalid_comp)
    assert res2.status.value == "failed_protocol"
    assert res2.validation["pass"] is False
    assert res2.validation["issues"][0]["category"] in ("schema_hallucination", "schema_component")
    assert "severity" in res2.validation["issues"][0]
    assert "suggestedFix" in res2.validation["issues"][0]


def test_studio_annotations(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)
    orchestrator.initialize_run(run_definition)

    # Check initial annotations
    annos = storage.read_annotations("run-test-123", "group-a", "case-1")
    assert len(annos["labels"]) == 0
    assert len(annos["notes"]) == 0

    # Write label annotation
    label_ann = StudioAnnotation(
        annotation_id="ann-1",
        created_at=datetime.now(timezone.utc),
        author="tester",
        type=StudioAnnotationType.LABEL,
        value="correct",
    )
    storage.write_annotation("run-test-123", "group-a", "case-1", label_ann)

    # Read back
    annos = storage.read_annotations("run-test-123", "group-a", "case-1")
    assert len(annos["labels"]) == 1
    assert annos["labels"][0]["value"] == "correct"

    # Write note annotation
    note_ann = StudioAnnotation(
        annotation_id="ann-2",
        created_at=datetime.now(timezone.utc),
        author="tester",
        type=StudioAnnotationType.NOTE,
        value="This is a note",
    )
    storage.write_annotation("run-test-123", "group-a", "case-1", note_ann)

    # Read back
    annos = storage.read_annotations("run-test-123", "group-a", "case-1")
    assert len(annos["notes"]) == 1
    assert annos["notes"][0]["value"] == "This is a note"

    # Verify index contains count and labels
    cases_index_path = run_definition.storage_root / "indexes" / "cases.json"
    cases_index = json.loads(cases_index_path.read_text(encoding="utf-8"))
    assert cases_index[0]["annotationCount"] == 2
    assert cases_index[0]["annotationLabels"] == ["correct"]


def test_pre_execution_compatibility_valid(tmp_path: Path):
    run_definition = build_run_definition(tmp_path)
    run_definition.catalog_profile_id = "a2ui-basic-v0_9"
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    orchestrator.validate_compatibility(run_definition)


def test_pre_execution_compatibility_invalid_renderer(tmp_path: Path):
    from genui_eval.studio_types import PlanningError
    import pytest
    run_definition = build_run_definition(tmp_path)
    run_definition.groups[0].cases[0].renderer = "invalid-renderer"
    run_definition.groups[0].cases[0].catalog_profile_id = "a2ui-basic-v0_9"

    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    with pytest.raises(PlanningError) as exc_info:
        orchestrator.validate_compatibility(run_definition)

    assert any("selected renderer 'invalid-renderer' is not supported" in err for err in exc_info.value.errors)


def test_pre_execution_compatibility_invalid_spec_version(tmp_path: Path):
    from genui_eval.studio_types import PlanningError
    import pytest
    run_definition = build_run_definition(tmp_path)
    run_definition.groups[0].cases[0].spec_version = "0.7"
    run_definition.groups[0].cases[0].protocol_version = "0.7"
    run_definition.groups[0].cases[0].catalog_profile_id = "a2ui-basic-v0_9"

    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    with pytest.raises(PlanningError) as exc_info:
        orchestrator.validate_compatibility(run_definition)

    assert any("requested unsupported spec version" in err or "does not match catalog profile" in err for err in exc_info.value.errors)


def test_protocol_registry_resolves_a2ui_and_openui(tmp_path: Path):
    registry = build_protocol_registry(tmp_path / ".genui-eval-studio")

    a2ui_config = registry.resolve_profile("a2ui-basic-v0_9")
    assert a2ui_config.protocol_id == "a2ui"
    assert a2ui_config.protocol_version == "0.9"
    assert a2ui_config.protocol_options["catalogProfileId"] == "a2ui-basic-v0_9"

    openui_config = registry.resolve_profile("openui-default-v1")
    assert openui_config.protocol_id == "openui"
    assert openui_config.protocol_version == "1"


def test_openui_skeleton_run_persists_protocol_artifacts(tmp_path: Path):
    groups = [
        StudioGroupSelection(
            group_id="openui-group",
            label="OpenUI Group",
            cases=[
                StudioCaseSelection(
                    case_id="openui-case",
                    group_id="openui-group",
                    prompt="Render an OpenUI panel",
                    protocol_id="openui",
                    protocol_version="1",
                    protocol_profile_id="openui-default-v1",
                    renderer="json",
                )
            ],
        )
    ]
    run_definition = create_run_definition(
        run_id="run-openui-123",
        name="OpenUI Run",
        groups=groups,
        model="test",
        grading_model="test",
        protocol_id="openui",
        protocol_version="1",
        protocol_profile_id="openui-default-v1",
        renderer="json",
    )
    run_definition.storage_root = tmp_path / ".genui-eval-studio"
    storage = StudioStorage(run_definition.storage_root)
    orchestrator = build_orchestrator(storage)

    orchestrator.run(run_definition, completion_provider=lambda _: '{"kind":"openui-test"}')

    case_dir = storage.case_dir("run-openui-123", "openui-group", "openui-case")
    protocol_data = json.loads((case_dir / "protocol.json").read_text(encoding="utf-8"))
    manifest = json.loads((case_dir / "artifacts" / "manifest.json").read_text(encoding="utf-8"))
    result = json.loads((case_dir / "result.json").read_text(encoding="utf-8"))

    assert protocol_data["protocolId"] == "openui"
    assert (case_dir / "raw" / "raw_completion.md").exists()
    assert (case_dir / "protocol" / "parsed.json").exists()
    assert manifest["artifacts"]["raw.raw_completion"] == "raw/raw_completion.md"
    assert result["protocol_id"] == "openui"


def test_create_rerun_script(tmp_path: Path):
    from unittest.mock import patch
    import sys
    import io
    import json
    from contextlib import redirect_stdout

    # 1. Initialize a run with two cases
    groups = [
        StudioGroupSelection(
            group_id="group-a",
            label="Group A",
            cases=[
                StudioCaseSelection(case_id="case-1", group_id="group-a", prompt="P1"),
                StudioCaseSelection(case_id="case-2", group_id="group-a", prompt="P2"),
            ],
        )
    ]
    run_definition = create_run_definition(
        run_id="run-original",
        name="Original Run",
        groups=groups,
        model="test",
        grading_model="test",
    )
    run_definition.catalog_profile_id = "a2ui-basic-v0_9"
    studio_root = tmp_path / ".genui-eval-studio"
    run_definition.storage_root = studio_root

    storage = StudioStorage(studio_root)
    orchestrator = build_orchestrator(storage)
    orchestrator.initialize_run(run_definition)

    # Mark case-1 as completed, case-2 remains queued/failed
    storage.write_json(
        storage.case_dir("run-original", "group-a", "case-1") / "status.json",
        {"status": "completed"}
    )
    storage.write_json(
        storage.case_dir("run-original", "group-a", "case-2") / "status.json",
        {"status": "failed_protocol"}
    )

    # 2. Invoke create_rerun.py CLI main
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))
    import create_rerun

    test_args = [
        "create_rerun.py",
        "--run-id", "run-original",
        "--group-id", "group-a",
        "--studio-root", str(studio_root)
    ]

    with patch.object(sys, "argv", test_args):
        f = io.StringIO()
        with redirect_stdout(f):
            create_rerun.main()

        output = f.getvalue()
        result = json.loads(output)

        assert "runId" in result
        assert result["totalCases"] == 1

        new_run_id = result["runId"]
        new_run_dir = studio_root / "runs" / new_run_id
        assert (new_run_dir / "run.json").exists()

        # Load the new run and check it only has case-2
        new_run_data = json.loads((new_run_dir / "run.json").read_text(encoding="utf-8"))
        assert len(new_run_data["groups"][0]["cases"]) == 1
        assert new_run_data["groups"][0]["cases"][0]["case_id"] == "case-2"

