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
import pytest

from genui_eval.protocols.registry import ProtocolRegistry
from genui_eval.run_executor import (
    build_completion_provider,
    call_openai_compatible_api,
    load_run_definition,
)
from genui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from genui_eval.studio_storage import StudioStorage
from genui_eval.studio_types import StudioCaseSelection, StudioGroupSelection, StudioExecutionMode

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
