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

"""Build a sample Eval Studio run skeleton on local disk."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

# Add eval root to import path when running as a script from bin/
SCRIPT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = SCRIPT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from a2ui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from a2ui_eval.studio_storage import build_default_studio_root
from a2ui_eval.studio_types import StudioCaseSelection, StudioGroupSelection

CATALOG_PATH = EVAL_ROOT.parent / "specification" / "v0_9" / "catalogs" / "basic" / "catalog.json"
SAMPLE_COMPLETION = """<a2ui-json>
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
          \"text\": \"Hello from Eval Studio MVP\",
          \"variant\": \"body\"
        }
      ]
    }
  }
]
</a2ui-json>"""


def build_sample_groups() -> list[StudioGroupSelection]:
    """Return a deterministic starter dataset for MVP UI development."""

    cases = [
        StudioCaseSelection(
            case_id="hello-world",
            group_id="starter-group",
            prompt="Render a simple hello world label.",
            description="Small starter case for Eval Studio MVP.",
            target="A root Text component saying hello.",
            spec_version="0.9",
            renderer="react",
        ),
        StudioCaseSelection(
            case_id="contact-card",
            group_id="starter-group",
            prompt="Render a compact contact card with name and email.",
            description="Second starter case to exercise group rendering.",
            target="A structured contact card surface.",
            spec_version="0.9",
            renderer="react",
        ),
    ]

    return [
        StudioGroupSelection(
            group_id="starter-group",
            label="Starter Group",
            cases=cases,
            metadata={"source": "eval-studio-mvp"},
        )
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a sample Eval Studio run")
    parser.add_argument("--name", default="Eval Studio MVP Run", help="Human-friendly run name")
    parser.add_argument(
        "--model",
        default="google/gemini-3-flash-preview",
        help="Model identifier to record in the run metadata",
    )
    parser.add_argument(
        "--grading-model",
        default="google/gemini-3-flash-preview",
        help="Judge model identifier to record in the run metadata",
    )
    args = parser.parse_args()

    run_id = f"run-{uuid.uuid4().hex[:12]}"
    orchestrator = StudioOrchestrator.for_repo(EVAL_ROOT)
    run_definition = create_run_definition(
        run_id=run_id,
        name=args.name,
        groups=build_sample_groups(),
        model=args.model,
        grading_model=args.grading_model,
        catalog_profile_id="a2ui-basic-v0_9",
    )

    def completion_provider(case: StudioCaseSelection) -> str:
        return SAMPLE_COMPLETION.replace("Hello from Eval Studio MVP", f"{case.case_id}: Eval Studio MVP")

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
