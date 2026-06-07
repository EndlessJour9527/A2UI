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

"""Protocol adapter used by Eval Studio MVP."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from a2ui.parser.parser import parse_response
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.manager import A2uiSchemaManager

from .catalog_registry import ResolvedCatalogConfig
from .studio_types import StudioCaseResult, StudioCaseSelection, StudioRunStatus


def categorize_validation_error(error_msg: str) -> str:
    """Categorize validation error messages for diagnostics."""
    msg_lower = error_msg.lower()
    
    # Topology errors
    if any(k in msg_lower for k in ("circular", "orphan", "reachable", "topology")):
        return "topology"
        
    # Integrity errors
    if any(k in msg_lower for k in ("integrity", "unique", "duplicate", "must exist", "root component", "does not exist")):
        return "integrity"
        
    # Schema Structure (message level / JSON level)
    if any(k in msg_lower for k in ("is not an object", "unknown message type", "json", "syntax", "no a2ui json")):
        return "schema_structure"
        
    # Schema Hallucination (made up elements/properties)
    if any(k in msg_lower for k in ("additional properties", "unevaluated properties", "not allowed", "unknown key")):
        return "schema_hallucination"
        
    # Schema Component (standard schema validation)
    return "schema_component"


class ProtocolEvalAdapter:
    """Thin wrapper around the official SDK-backed parsing and validation flow."""

    def __init__(
        self,
        catalog_path: Path | None = None,
        version: str = "0.9",
        resolved_config: ResolvedCatalogConfig | None = None,
    ):
        if resolved_config is not None:
            self.version = resolved_config.spec_version
            self.catalog_path = resolved_config.catalog_schema_path
            catalog_config = CatalogConfig.from_path("catalog", str(self.catalog_path))
        elif catalog_path is not None:
            self.catalog_path = Path(catalog_path)
            self.version = version
            catalog_config = CatalogConfig.from_path("catalog", str(self.catalog_path))
        else:
            raise ValueError("Either resolved_config or catalog_path must be provided")

        self.manager = A2uiSchemaManager(version=self.version, catalogs=[catalog_config])
        self.catalog = self.manager.get_selected_catalog()
        self.validator = self.catalog.validator

    def evaluate_case(
        self,
        run_id: str,
        selection: StudioCaseSelection,
        completion: str,
        semantic_evaluation: dict[str, Any] | None = None,
    ) -> StudioCaseResult:
        """Parse and validate one raw completion into a normalized case result."""

        validation: dict[str, Any]
        status = StudioRunStatus.COMPLETED
        error: str | None = None
        parsed_messages: list[Any] = []

        try:
            parts = parse_response(completion)
            for part in parts:
                if part.a2ui_json:
                    if isinstance(part.a2ui_json, list):
                        parsed_messages.extend(part.a2ui_json)
                    else:
                        parsed_messages.append(part.a2ui_json)

            if not parsed_messages:
                status = StudioRunStatus.FAILED_PROTOCOL
                error = "No A2UI JSON found in response"
                validation = {
                    "pass": False,
                    "errors": [error],
                    "explanation": error,
                    "issues": [{"message": error, "category": "schema_structure"}],
                }
            else:
                self.validator.validate(parsed_messages)
                validation = {
                    "pass": True,
                    "errors": [],
                    "explanation": "Valid A2UI payload",
                    "issues": [],
                }
        except Exception as exc:  # pylint: disable=broad-exception-caught
            status = StudioRunStatus.FAILED_PROTOCOL
            error = str(exc)
            
            raw_errors = []
            if "Validation failed:" in error:
                for line in error.split("\n"):
                    stripped = line.strip()
                    if stripped.startswith("- "):
                        raw_errors.append(stripped[2:])
            
            if not raw_errors:
                raw_errors = [error]
                
            issues = []
            for err in raw_errors:
                issues.append({
                    "message": err,
                    "category": categorize_validation_error(err)
                })
                
            validation = {
                "pass": False,
                "errors": raw_errors,
                "explanation": error,
                "issues": issues,
            }

        normalized_messages = parsed_messages
        semantic_payload = semantic_evaluation or {
            "grade": None,
            "pass": status == StudioRunStatus.COMPLETED,
            "issues": [],
        }

        return StudioCaseResult(
            run_id=run_id,
            group_id=selection.group_id,
            case_id=selection.case_id,
            status=status,
            prompt=selection.prompt,
            raw_completion=completion,
            parsed_messages=parsed_messages,
            normalized_messages=normalized_messages,
            validation=validation,
            semantic_evaluation=semantic_payload,
            renderer=selection.renderer,
            spec_version=selection.spec_version,
            catalog_profile_id=selection.catalog_profile_id,
            error=error,
            metadata={
                "catalogId": selection.catalog_id,
                "catalogProfileId": selection.catalog_profile_id,
                "description": selection.description,
                "target": selection.target,
            },
        )
