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

from dotenv import load_dotenv

# Add the project directory to sys.path
CURRENT_DIR = Path(__file__).resolve().parent
EVAL_ROOT = CURRENT_DIR.parent
if str(EVAL_ROOT) not in sys.path:
    sys.path.insert(0, str(EVAL_ROOT))

# Load environment variables
load_dotenv(CURRENT_DIR / ".env")
load_dotenv(EVAL_ROOT / ".env")
load_dotenv()

from genui_eval.studio_orchestrator import StudioOrchestrator
from genui_eval.studio_storage import StudioStorage, build_default_studio_root
from genui_eval.studio_types import (
    PlanningError,
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
                    protocol_id=c_data.get("protocol_id", "a2ui"),
                    protocol_version=c_data.get(
                        "protocol_version", c_data.get("spec_version", "0.9")
                    ),
                    protocol_profile_id=c_data.get("protocol_profile_id"),
                    protocol_options=c_data.get("protocol_options", {}),
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
        protocol_id=data.get("protocol_id", "a2ui"),
        protocol_version=data.get("protocol_version", data.get("spec_version", "0.9")),
        protocol_profile_id=data.get("protocol_profile_id"),
        protocol_options=data.get("protocol_options", {}),
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


def call_openai_compatible_api(
    model_name: str,
    prompt: str,
    system_prompt: str | None = None,
) -> str:
    """Call a local OpenAI-compatible chat completions endpoint."""
    base_url = os.environ.get("GENUI_EVAL_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8045/v1")
    api_key = os.environ.get("GENUI_EVAL_LOCAL_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError(
            "GENUI_EVAL_LOCAL_OPENAI_API_KEY or OPENAI_API_KEY must be set for local-openai provider"
        )

    # Strip any proxy prefix like proxy_8045_ before passing to completions API
    if model_name.startswith("proxy_"):
        parts = model_name.split("_", 2)
        if len(parts) >= 3:
            model_name = parts[2]

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": model_name,
        "messages": messages,
        "temperature": 0.1,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"Failed to fetch completion from local OpenAI-compatible API: {e}")
        if hasattr(e, "read"):
            try:
                error_body = e.read().decode("utf-8")
                logger.error(f"Local OpenAI-compatible API error details: {error_body}")
            except Exception:
                pass
        raise


def build_completion_provider(
    provider_type: str,
    run_def: StudioRunDefinition,
    orchestrator: StudioOrchestrator,
) -> callable:
    """Create a completion provider closure based on chosen provider type."""
    from genui_eval.providers import registry

    # Extract base provider name and model name
    base_provider = provider_type
    model_name = run_def.model

    if ":" in provider_type:
        parts = provider_type.split(":", 1)
        base_provider = parts[0]
        model_name = parts[1]

    def provider(case: StudioCaseSelection) -> str:
        if base_provider == "mock":
            if case.protocol_id == "openui":
                return json.dumps(
                    {
                        "type": "openui.mock",
                        "caseId": case.case_id,
                        "text": f"{case.case_id}: Eval Studio MVP Mock Response",
                    }
                )
            return SAMPLE_COMPLETION.replace("Hello from Eval Studio MVP", f"{case.case_id}: Eval Studio MVP Mock Response")
        
        elif base_provider == "static":
            if case.target and (case.protocol_id == "openui" or "<a2ui-json>" in case.target):
                return case.target
            if case.protocol_id == "openui":
                return json.dumps({"type": "openui.static_fallback", "caseId": case.case_id})
            return SAMPLE_COMPLETION.replace("Hello from Eval Studio MVP", f"{case.case_id}: Eval Studio MVP Static Target Fallback")
        
        # Look up provider in the registry
        provider_obj = registry.get(base_provider)
        
        logger.info(
            f"Executing case '{case.case_id}' using provider '{provider_obj.name}' "
            f"and model '{model_name}'"
        )
        
        resolved = orchestrator.protocol_registry.resolve_for_case(run_def, case)
        system_prompt = resolved.pack.build_prompt(case, resolved)
        
        prompt = case.prompt
        if case.context:
            prompt = f"Context:\n{case.context}\n\n{prompt}"
            
        return provider_obj.call_api(model_name, prompt, system_prompt)
        
    return provider
            
    return provider


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute a persisted Eval Studio run.")
    parser.add_argument("run_id", help="The unique identifier of the run to execute")
    parser.add_argument(
        "--provider",
        default="mock",
        help=(
            "Completion provider to use: mock, static, llm:<model_name>, or "
            "local-openai:<model_name> for a local OpenAI-compatible proxy"
        ),
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only run pre-execution compatibility checks and exit",
    )
    args = parser.parse_args()

    logger.info(f"Initializing run executor for run ID '{args.run_id}' using provider '{args.provider}'")

    try:
        # Initialize orchestrator
        orchestrator = StudioOrchestrator.for_repo(EVAL_ROOT)
        
        # Load persisted run definition
        run_def = load_run_definition(orchestrator.storage, args.run_id)
        run_def.metadata = {
            **run_def.metadata,
            "completion_provider": args.provider,
        }
        
        if args.validate_only:
            logger.info("Running validation checks only")
            try:
                orchestrator.validate_compatibility(run_def)
                logger.info("Validation checks PASSED")
                print(json.dumps({"valid": True}))
                sys.exit(0)
            except PlanningError as pe:
                logger.error(f"Validation checks FAILED: {pe.errors}")
                print(json.dumps({"valid": False, "errors": pe.errors}), file=sys.stderr)
                sys.exit(2)

        # Construct completion provider
        completion_provider = build_completion_provider(args.provider, run_def, orchestrator)
        
        # Execute run
        logger.info(f"Starting orchestration execution for run '{args.run_id}'")
        orchestrator.run(run_def, completion_provider=completion_provider)
        
        logger.info(f"Orchestration execution completed successfully for run '{args.run_id}'")
        sys.exit(0)
    except PlanningError as pe:
        logger.error(f"Planning validation failed during execution: {pe.errors}")
        try:
            summary = orchestrator.storage.build_summary(run_def)
            summary.status = StudioRunStatus.ERROR_INFRASTRUCTURE
            summary.latest_error = "\n".join(pe.errors)
            orchestrator.storage.update_run_summary(summary)
        except Exception as summary_err:
            logger.error(f"Failed to update run summary with planning error: {summary_err}")
        sys.exit(2)
    except Exception as e:
        logger.exception(f"Execution failed for run '{args.run_id}': {e}")
        try:
            # Safely resolve or load run_def and orchestrator if they exist
            try:
                orch = orchestrator
            except NameError:
                orch = StudioOrchestrator.for_repo(EVAL_ROOT)
                
            try:
                r_def = run_def
            except NameError:
                r_def = load_run_definition(orch.storage, args.run_id)
                
            summary = orch.storage.build_summary(r_def)
            summary.status = StudioRunStatus.ERROR_INFRASTRUCTURE
            summary.latest_error = str(e)
            orch.storage.update_run_summary(summary)
        except Exception as summary_err:
            logger.error(f"Failed to update run summary with execution error: {summary_err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
