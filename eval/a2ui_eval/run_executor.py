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

"""CLI entry point to execute an Eval Studio run."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Add the project directory to sys.path
CURRENT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = CURRENT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.manager import A2uiSchemaManager
from a2ui_eval.studio_orchestrator import StudioOrchestrator
from a2ui_eval.studio_storage import StudioStorage, build_default_studio_root
from a2ui_eval.studio_types import (
    StudioCaseSelection,
    StudioExecutionMode,
    StudioGroupSelection,
    StudioRunDefinition,
    StudioRunStatus,
)

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


SAMPLE_COMPLETION = """<a2ui-json>
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
          "component": "Text",
          "text": "Hello from Eval Studio MVP",
          "variant": "body"
        }
      ]
    }
  }
]
</a2ui-json>"""


def load_run_definition(storage: StudioStorage, run_id: str) -> StudioRunDefinition:
    """Load and reconstruct StudioRunDefinition from runs/<run_id>/run.json."""
    run_path = storage.run_dir(run_id) / "run.json"
    if not run_path.exists():
        raise FileNotFoundError(f"Run definition file not found: {run_path}")

    with run_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Reconstruct groups and cases
    groups = []
    for g_data in data.get("groups", []):
        cases = []
        for c_data in g_data.get("cases", []):
            cases.append(
                StudioCaseSelection(
                    case_id=c_data["case_id"],
                    prompt=c_data["prompt"],
                    group_id=c_data.get("group_id", "default"),
                    description=c_data.get("description"),
                    context=c_data.get("context"),
                    target=c_data.get("target"),
                    spec_version=c_data.get("spec_version", "0.9"),
                    renderer=c_data.get("renderer", "react"),
                    catalog_id=c_data.get("catalog_id"),
                    catalog_profile_id=c_data.get("catalog_profile_id"),
                    metadata=c_data.get("metadata", {}),
                )
            )
        groups.append(
            StudioGroupSelection(
                group_id=g_data["group_id"],
                label=g_data.get("label", g_data["group_id"]),
                cases=cases,
                metadata=g_data.get("metadata", {}),
            )
        )

    created_at_str = data.get("created_at")
    if created_at_str:
        created_at = datetime.fromisoformat(created_at_str)
    else:
        created_at = datetime.now(timezone.utc)

    return StudioRunDefinition(
        run_id=data["run_id"],
        name=data.get("name", "Unnamed Run"),
        created_at=created_at,
        groups=groups,
        model=data.get("model", "mock"),
        grading_model=data.get("grading_model", "mock"),
        execution_mode=StudioExecutionMode(data.get("execution_mode", "serial")),
        max_parallelism=data.get("max_parallelism", 1),
        repeat_count=data.get("repeat_count", 1),
        renderer=data.get("renderer", "react"),
        spec_version=data.get("spec_version", "0.9"),
        catalog_profile_id=data.get("catalog_profile_id"),
        storage_root=storage.root,
        metadata=data.get("metadata", {}),
    )


def call_gemini_api(model_name: str, prompt: str, system_prompt: str | None = None) -> str:
    """Call Gemini API via direct HTTP request to bypass Pydantic Python 3.14 issues."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")

    # Clean up model name: google/gemini-2.5-flash -> gemini-2.5-flash
    if model_name.startswith("google/"):
        model_name = model_name[7:]

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    
    data = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1
        }
    }

    if system_prompt:
        data["systemInstruction"] = {
            "parts": [
                {"text": system_prompt}
            ]
        }

    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        logger.error(f"Failed to fetch completion from Gemini API: {e}")
        if hasattr(e, "read"):
            try:
                error_body = e.read().decode("utf-8")
                logger.error(f"Gemini API Error details: {error_body}")
            except Exception:
                pass
        raise


def build_completion_provider(
    provider_type: str,
    run_def: StudioRunDefinition,
    orchestrator: StudioOrchestrator,
) -> callable:
    """Create a completion provider closure based on chosen provider type."""
    
    def provider(case: StudioCaseSelection) -> str:
        if provider_type == "mock":
            return SAMPLE_COMPLETION.replace("Hello from Eval Studio MVP", f"{case.case_id}: Eval Studio MVP Mock Response")
        
        elif provider_type == "static":
            # Return target if it contains A2UI json tags, otherwise fallback to sample
            if case.target and "<a2ui-json>" in case.target:
                return case.target
            # Try parsing metadata target or fallback
            return SAMPLE_COMPLETION.replace("Hello from Eval Studio MVP", f"{case.case_id}: Eval Studio MVP Static Target Fallback")
        
        elif provider_type.startswith("llm"):
            # Determine target model
            model_name = run_def.model
            if ":" in provider_type:
                model_name = provider_type.split(":", 1)[1]
            
            logger.info(f"Executing LLM generation for case '{case.case_id}' using model '{model_name}'")
            
            # Resolve catalog profile to build system instructions
            profile_id = case.catalog_profile_id or run_def.catalog_profile_id or "a2ui-basic-v0_9"
            resolved = orchestrator.registry.resolve_profile(profile_id)
            
            catalog_config = CatalogConfig.from_path(profile_id, str(resolved.catalog_schema_path))
            manager = A2uiSchemaManager(version=resolved.spec_version, catalogs=[catalog_config])
            
            workflow_override = f"""
Additional Rules:
1. Generate a 'createSurface' message with surfaceId 'main' and catalogId '{resolved.catalog_id}'.
2. Generate a 'updateComponents' message with surfaceId 'main' containing the requested UI.
3. Among the 'updateComponents' messages in the output, there MUST be one root component with id: 'root'.
4. Ensure all component children are referenced by ID, NOT nested inline as objects.
"""
            system_prompt = manager.generate_system_prompt(
                role_description="You are an AI assistant. Based on the following request, generate a stream of JSON messages that conform to the provided JSON Schemas.",
                workflow_description=workflow_override,
                include_schema=True,
            )
            
            prompt = case.prompt
            if case.context:
                prompt = f"Context:\n{case.context}\n\n{prompt}"
                
            return call_gemini_api(model_name, prompt, system_prompt)
        
        else:
            raise ValueError(f"Unknown provider type: {provider_type}")
            
    return provider


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute a persisted Eval Studio run.")
    parser.add_argument("run_id", help="The unique identifier of the run to execute")
    parser.add_argument(
        "--provider",
        default="mock",
        help="Completion provider to use: mock, static, or llm:<model_name> (e.g. llm:gemini-2.5-flash)",
    )
    args = parser.parse_args()

    logger.info(f"Initializing run executor for run ID '{args.run_id}' using provider '{args.provider}'")

    try:
        # Initialize orchestrator
        orchestrator = StudioOrchestrator.for_repo(EVAL_ROOT)
        
        # Load persisted run definition
        run_def = load_run_definition(orchestrator.storage, args.run_id)
        
        # Construct completion provider
        completion_provider = build_completion_provider(args.provider, run_def, orchestrator)
        
        # Execute run
        logger.info(f"Starting orchestration execution for run '{args.run_id}'")
        orchestrator.run(run_def, completion_provider=completion_provider)
        
        logger.info(f"Orchestration execution completed successfully for run '{args.run_id}'")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Execution failed for run '{args.run_id}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
