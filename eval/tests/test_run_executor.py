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
import json
import sys
import pytest

from genui_eval.protocols.registry import ProtocolRegistry
from genui_eval.run_executor import (
    build_completion_provider,
    call_openai_compatible_api,
    load_run_definition,
)
from genui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from genui_eval.studio_storage import StudioStorage
from genui_eval.studio_types import (
    StudioCaseSelection,
    StudioGroupSelection,
    StudioExecutionMode,
)

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
    studio_root = tmp_path / ".genui-eval-studio"
    storage = StudioStorage(studio_root)
    
    # Initialize registry
    repo_root = Path(__file__).resolve().parents[2]
    registry = ProtocolRegistry(studio_root, repo_root)
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
    
    orchestrator = StudioOrchestrator(storage, registry)
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


def test_openai_compatible_api_uses_local_proxy(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": "local proxy completion",
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(req):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GENUI_EVAL_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8045/v1")
    monkeypatch.setenv("GENUI_EVAL_LOCAL_OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    completion = call_openai_compatible_api(
        "gemini-3.5-flash-extra-low",
        "Hello",
        "System prompt",
    )

    assert completion == "local proxy completion"
    assert captured["url"] == "http://127.0.0.1:8045/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["body"]["model"] == "gemini-3.5-flash-extra-low"
    assert captured["body"]["messages"] == [
        {"role": "system", "content": "System prompt"},
        {"role": "user", "content": "Hello"},
    ]


def test_call_openai_compatible_api_strips_proxy_prefix(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": "local proxy completion",
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(req):
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GENUI_EVAL_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8045/v1")
    monkeypatch.setenv("GENUI_EVAL_LOCAL_OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    completion = call_openai_compatible_api(
        "proxy_8045_gemini-3.5-flash-extra-low",
        "Hello",
        "System prompt",
    )

    assert completion == "local proxy completion"
    assert captured["body"]["model"] == "gemini-3.5-flash-extra-low"


def test_validate_only_does_not_prepare_execution(monkeypatch, tmp_path: Path):
    studio_root = tmp_path / ".genui-eval-studio"
    storage = StudioStorage(studio_root)
    run_definition = create_run_definition(
        run_id="run-validate-only",
        name="Validate Only",
        groups=[
            StudioGroupSelection(
                group_id="group-validate",
                label="Group Validate",
                cases=[
                    StudioCaseSelection(
                        case_id="case-validate",
                        group_id="group-validate",
                        prompt="Prompt",
                    )
                ],
            )
        ],
        model="test-model",
        grading_model="judge-model",
        execution_mode=StudioExecutionMode.SERIAL,
    )
    run_definition.storage_root = studio_root

    validate_calls: list[str] = []

    class FakeOrchestrator:
        def __init__(self, storage: StudioStorage):
            self.storage = storage

        def validate_compatibility(self, loaded_run_definition):
            validate_calls.append(loaded_run_definition.run_id)

    fake_orchestrator = FakeOrchestrator(storage)

    monkeypatch.setattr(
        "genui_eval.run_executor.StudioOrchestrator.for_repo",
        lambda eval_root: fake_orchestrator,
    )
    monkeypatch.setattr(
        "genui_eval.run_executor.load_run_definition",
        lambda loaded_storage, run_id: run_definition,
    )
    monkeypatch.setattr(
        storage,
        "prepare_for_execution",
        lambda *args, **kwargs: pytest.fail("prepare_for_execution should not run during validation"),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_executor",
            run_definition.run_id,
            "--validate-only",
            "--provider",
            "nvidia:deepseek-ai/deepseek-v4-flash",
        ],
    )

    with pytest.raises(SystemExit) as excinfo:
        from genui_eval import run_executor as run_executor_module

        run_executor_module.main()

    assert excinfo.value.code == 0
    assert validate_calls == [run_definition.run_id]
    assert "completion_provider" not in run_definition.metadata


def test_execution_id_is_persisted_for_real_execution(monkeypatch):
    run_definition = create_run_definition(
        run_id="run-execution-id",
        name="Execution Id",
        groups=[
            StudioGroupSelection(
                group_id="group-execution",
                label="Group Execution",
                cases=[
                    StudioCaseSelection(
                        case_id="case-execution",
                        group_id="group-execution",
                        prompt="Prompt",
                    )
                ],
            )
        ],
        model="test-model",
        grading_model="judge-model",
        execution_mode=StudioExecutionMode.SERIAL,
    )
    calls: dict[str, object] = {}

    class FakeStorage:
        def prepare_for_execution(self, loaded_run_definition, provider, execution_id=None):
            calls["prepare"] = (loaded_run_definition.run_id, provider, execution_id)

        def write_execution_metadata(self, run_id, execution_id, provider, *, pid=None, started_at=None):
            calls["metadata"] = (run_id, execution_id, provider, pid)

    class FakeOrchestrator:
        def __init__(self):
            self.storage = FakeStorage()

        def run(self, loaded_run_definition, completion_provider, initialize_storage=True):
            calls["run"] = (loaded_run_definition.run_id, initialize_storage)

    fake_orchestrator = FakeOrchestrator()

    monkeypatch.setattr(
        "genui_eval.run_executor.StudioOrchestrator.for_repo",
        lambda eval_root: fake_orchestrator,
    )
    monkeypatch.setattr(
        "genui_eval.run_executor.load_run_definition",
        lambda loaded_storage, run_id: run_definition,
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "run_executor",
            run_definition.run_id,
            "--provider",
            "nvidia:z-ai/glm-5.1",
            "--execution-id",
            "exec-cli-123",
        ],
    )

    with pytest.raises(SystemExit) as excinfo:
        from genui_eval import run_executor as run_executor_module

        run_executor_module.main()

    assert excinfo.value.code == 0
    assert calls["prepare"] == ("run-execution-id", "nvidia:z-ai/glm-5.1", "exec-cli-123")
    assert calls["metadata"][:3] == ("run-execution-id", "exec-cli-123", "nvidia:z-ai/glm-5.1")
    assert calls["run"] == ("run-execution-id", False)
    assert run_definition.metadata["latest_execution_id"] == "exec-cli-123"
