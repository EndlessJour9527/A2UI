#!/usr/bin/env python3
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

"""Create an GenUI Eval Studio run using the custom Ink catalog and renderer."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

# Add eval root to import path
SCRIPT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = SCRIPT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from genui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from genui_eval.studio_storage import build_default_studio_root
from genui_eval.studio_types import StudioCaseSelection, StudioGroupSelection

INK_COMPLETION = """<a2ui-json>
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "main",
      "catalogId": "https://jsar-project.github.io/ink/a2ui/catalog.json"
    }
  },
  {
    "version": "v0.9",
    "updateComponents": {
      "surfaceId": "main",
      "components": [
        {
          "id": "root",
          "component": "text",
          "props": {
            "content": "Hello from Ink Custom Catalog Case!"
          }
        }
      ]
    }
  }
]
</a2ui-json>"""


def build_ink_groups() -> list[StudioGroupSelection]:
    """Return a group with custom catalog cases."""

    cases = [
        StudioCaseSelection(
            case_id="ink-hello-text",
            group_id="ink-custom-group",
            prompt="Render an Ink text component saying 'Hello from Ink Custom Catalog Case!'.",
            description="Ink custom catalog text render test.",
            target=INK_COMPLETION,
            spec_version="0.9",
            renderer="ink",
            protocol_id="a2ui",
            protocol_version="0.9",
            protocol_profile_id="a2ui-ink-v0_9",
            protocol_options={"catalogProfileId": "ink-a2ui-v0_9"},
            catalog_id="https://jsar-project.github.io/ink/a2ui/catalog.json",
            catalog_profile_id="ink-a2ui-v0_9",
        )
    ]

    return [
        StudioGroupSelection(
            group_id="ink-custom-group",
            label="Ink Custom Catalog Group",
            cases=cases,
            metadata={"source": "ink-custom-catalog-seed"},
        )
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a custom catalog run")
    parser.add_argument("--name", default="Ink Custom Catalog Run", help="Run name")
    parser.add_argument(
        "--model",
        default="mock",
        help="Model identifier to record in the run metadata",
    )
    args = parser.parse_args()

    run_id = f"run-ink-{uuid.uuid4().hex[:8]}"
    orchestrator = StudioOrchestrator.for_repo(EVAL_ROOT)
    
    run_definition = create_run_definition(
        run_id=run_id,
        name=args.name,
        groups=build_ink_groups(),
        model=args.model,
        grading_model="mock",
        protocol_id="a2ui",
        protocol_version="0.9",
        protocol_profile_id="a2ui-ink-v0_9",
        protocol_options={"catalogProfileId": "ink-a2ui-v0_9"},
        catalog_profile_id="ink-a2ui-v0_9",
    )

    # Use the static provider to supply the custom catalog target completion
    def completion_provider(case: StudioCaseSelection) -> str:
        return INK_COMPLETION

    # Run the orchestrator to process and compile results
    orchestrator.run(run_definition, completion_provider=completion_provider)

    studio_root = build_default_studio_root(EVAL_ROOT)
    payload = {
        "studioRoot": str(studio_root),
        "runId": run_id,
        "runPath": str(studio_root / "runs" / run_id),
        "summaryPath": str(studio_root / "runs" / run_id / "summary.json"),
        "indexesPath": str(studio_root / "indexes" / "runs.json"),
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
