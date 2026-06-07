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

"""Unit tests for the run executor."""

from __future__ import annotations

from pathlib import Path
import pytest

from a2ui_eval.catalog_registry import CatalogRegistry
from a2ui_eval.run_executor import load_run_definition, build_completion_provider
from a2ui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from a2ui_eval.studio_storage import StudioStorage
from a2ui_eval.studio_types import StudioCaseSelection, StudioGroupSelection, StudioExecutionMode
from a2ui_eval.studio_adapter import ProtocolEvalAdapter

CATALOG_PATH = (
    Path(__file__).resolve().parents[2]
    / "specification"
    / "v0_9"
    / "catalogs"
    / "basic"
    / "catalog.json"
)


def test_run_executor_mock_flow(tmp_path: Path):
    # Setup storage
    studio_root = tmp_path / ".a2ui-eval-studio"
    storage = StudioStorage(studio_root)
    
    # Initialize registry
    repo_root = Path(__file__).resolve().parents[2]
    registry = CatalogRegistry(studio_root, repo_root)
    registry.ensure_seeded()
    registry.load()
    
    # Create a dummy run definition
    cases = [
        StudioCaseSelection(
            case_id="case-exec-1",
            group_id="group-exec",
            prompt="Test prompt",
            catalog_profile_id="a2ui-basic-v0_9",
        )
    ]
    groups = [
        StudioGroupSelection(
            group_id="group-exec",
            label="Group Exec",
            cases=cases,
        )
    ]
    run_def = create_run_definition(
        run_id="run-exec-123",
        name="Exec Test",
        groups=groups,
        model="test-model",
        grading_model="judge-model",
        execution_mode=StudioExecutionMode.SERIAL,
        catalog_profile_id="a2ui-basic-v0_9",
    )
    run_def.storage_root = studio_root
    
    adapter = ProtocolEvalAdapter(catalog_path=CATALOG_PATH)
    orchestrator = StudioOrchestrator(storage, adapter, registry)
    orchestrator.initialize_run(run_def)
    
    # Check that it loads back
    loaded_def = load_run_definition(storage, "run-exec-123")
    assert loaded_def.run_id == "run-exec-123"
    assert len(loaded_def.groups) == 1
    assert loaded_def.groups[0].cases[0].case_id == "case-exec-1"
    
    # Test builder
    provider = build_completion_provider("mock", loaded_def, orchestrator)
    completion = provider(loaded_def.groups[0].cases[0])
    assert "Mock Response" in completion
