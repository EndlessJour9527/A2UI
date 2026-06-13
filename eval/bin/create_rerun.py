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

"""Create a rerun of failed cases in a group for GenUI Eval Studio."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
import shutil
from pathlib import Path
from datetime import datetime, timezone

# Add eval root to import path
SCRIPT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = SCRIPT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from genui_eval.studio_orchestrator import StudioOrchestrator, create_run_definition
from genui_eval.studio_storage import build_default_studio_root, StudioStorage
from genui_eval.studio_types import (
    StudioCaseSelection,
    StudioGroupSelection,
    StudioExecutionMode,
    StudioRunStatus,
    to_jsonable,
)
from genui_eval.run_executor import load_run_definition


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a rerun from failed cases of a group")
    parser.add_argument("--run-id", required=True, help="Original run ID")
    parser.add_argument("--group-id", required=True, help="Group ID to rerun failed cases from")
    parser.add_argument("--name", help="New run name")
    parser.add_argument("--studio-root", help="Override Eval Studio root path")
    args = parser.parse_args()

    if args.studio_root:
        studio_root = Path(args.studio_root)
    else:
        studio_root = build_default_studio_root(EVAL_ROOT)

    storage = StudioStorage(studio_root)
    if not storage.run_dir(args.run_id).exists():
        print(json.dumps({"error": f"Original run '{args.run_id}' not found"}), file=sys.stderr)
        sys.exit(1)

    try:
        # Load run definition
        orig_run = load_run_definition(storage, args.run_id)
        
        # Find group
        orig_group = next((g for g in orig_run.groups if g.group_id == args.group_id), None)
        if not orig_group:
            print(json.dumps({"error": f"Group '{args.group_id}' not found in run '{args.run_id}'"}), file=sys.stderr)
            sys.exit(1)

        # Filter failed cases
        failed_cases = []
        for case in orig_group.cases:
            status_path = storage.case_dir(args.run_id, args.group_id, case.case_id) / "status.json"
            status = "queued"
            if status_path.exists():
                try:
                    status = json.loads(status_path.read_text(encoding="utf-8")).get("status", "queued")
                except Exception:
                    pass
            if status != "completed":
                failed_cases.append(case)

        if not failed_cases:
            print(json.dumps({"error": f"No failed/incomplete cases found in group '{args.group_id}'"}), file=sys.stderr)
            sys.exit(1)

        # Create new run definition
        new_run_id = f"run-{uuid.uuid4().hex[:12]}"
        run_name = args.name or f"Rerun of {orig_group.label} (failed)"
        
        new_group = StudioGroupSelection(
            group_id=orig_group.group_id,
            label=orig_group.label,
            cases=failed_cases
        )

        new_run = create_run_definition(
            run_id=new_run_id,
            name=run_name,
            groups=[new_group],
            model=orig_run.model,
            grading_model=orig_run.grading_model,
            execution_mode=orig_run.execution_mode,
            protocol_id=orig_run.protocol_id,
            protocol_version=orig_run.protocol_version,
            protocol_profile_id=orig_run.protocol_profile_id,
            protocol_options=orig_run.protocol_options,
            catalog_profile_id=orig_run.catalog_profile_id,
        )

        # Initialize new run using orchestrator
        from genui_eval.protocols.registry import ProtocolRegistry

        repo_root = EVAL_ROOT.parent if EVAL_ROOT.name == "eval" else EVAL_ROOT
        protocol_registry = ProtocolRegistry(studio_root, repo_root)
        protocol_registry.load()
        orchestrator = StudioOrchestrator(storage=storage, protocol_registry=protocol_registry)
        
        plan = orchestrator.initialize_run(new_run)

        # Copy original source files if they exist to the new run
        orig_source_xlsx = storage.run_dir(args.run_id) / "source" / "source.xlsx"
        orig_source_json = storage.run_dir(args.run_id) / "source" / "source.json"
        
        orig_source = None
        is_json = False
        if orig_source_xlsx.exists():
            orig_source = orig_source_xlsx
        elif orig_source_json.exists():
            orig_source = orig_source_json
            is_json = True
            
        if orig_source is not None:
            new_source_dir = storage.run_dir(new_run_id) / "source"
            new_source_dir.mkdir(parents=True, exist_ok=True)
            source_filename = "source.json" if is_json else "source.xlsx"
            shutil.copy2(orig_source, new_source_dir / source_filename)
            
            # Write run-level manifest
            manifest_key = "source_json" if is_json else "source_excel"
            run_manifest = {
                "artifacts": {
                    "source_filename": f"source/{source_filename}",
                    manifest_key: f"source/{source_filename}"
                }
            }
            storage.write_json(storage.run_dir(new_run_id) / "manifest.json", run_manifest)

        print(json.dumps({
            "runId": new_run_id,
            "name": run_name,
            "totalCases": len(failed_cases),
            "plan": to_jsonable(plan)
        }))

    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
