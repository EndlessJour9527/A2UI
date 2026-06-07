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

"""Create an A2UI Studio run from an Excel file."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from pathlib import Path

# Add eval root to import path
SCRIPT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = SCRIPT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from a2ui_eval.excel_parser import parse_excel_test_set
from a2ui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from a2ui_eval.studio_storage import build_default_studio_root
from a2ui_eval.studio_types import StudioExecutionMode, to_jsonable


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a run from Excel")
    parser.add_argument("--file", required=True, help="Excel file path")
    parser.add_argument("--name", default="Excel Run", help="Run name")
    parser.add_argument("--model", required=True, help="Model identifier")
    parser.add_argument(
        "--grading-model",
        default="google/gemini-3-flash-preview",
        help="Grading model identifier",
    )
    parser.add_argument(
        "--catalog-profile-id", default="a2ui-basic-v0_9", help="Catalog profile ID"
    )
    parser.add_argument(
        "--execution-mode",
        default="serial",
        choices=["serial", "parallel"],
        help="Execution mode",
    )
    args = parser.parse_args()

    excel_path = Path(args.file)
    if not excel_path.exists():
        print(json.dumps({"error": f"File not found: {args.file}"}), file=sys.stderr)
        sys.exit(1)

    try:
        groups = parse_excel_test_set(excel_path)
        if not groups:
            print(json.dumps({"error": "No cases found in Excel file"}), file=sys.stderr)
            sys.exit(1)

        run_id = f"run-{uuid.uuid4().hex[:12]}"
        exec_mode = (
            StudioExecutionMode.SERIAL
            if args.execution_mode == "serial"
            else StudioExecutionMode.PARALLEL
        )

        orchestrator = StudioOrchestrator.for_repo(EVAL_ROOT)
        run_definition = create_run_definition(
            run_id=run_id,
            name=args.name,
            groups=groups,
            model=args.model,
            grading_model=args.grading_model,
            execution_mode=exec_mode,
            catalog_profile_id=args.catalog_profile_id,
        )

        # Populate catalog profile for cases if not set
        for group in run_definition.groups:
            for case in group.cases:
                if not case.catalog_profile_id:
                    case.catalog_profile_id = run_definition.catalog_profile_id

        plan = orchestrator.initialize_run(run_definition)

        # Save source file
        studio_root = build_default_studio_root(EVAL_ROOT)
        source_dir = studio_root / "runs" / run_id / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(excel_path, source_dir / "source.xlsx")

        result = {
            "runId": run_id,
            "name": run_definition.name,
            "model": run_definition.model,
            "catalogProfileId": run_definition.catalog_profile_id,
            "executionMode": run_definition.execution_mode.value,
            "totalCases": sum(len(g.cases) for g in groups),
            "groupsCount": len(groups),
            "plan": to_jsonable(plan),
        }
        print(json.dumps(result, indent=2))

    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
