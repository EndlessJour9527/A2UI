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

"""A2UI protocol adapter used by GenUI Eval Studio."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from a2ui.parser.parser import parse_response
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.manager import A2uiSchemaManager

from ...studio_types import StudioCaseResult, StudioCaseSelection, StudioRunStatus
from .catalog_registry import ResolvedCatalogConfig


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


def analyze_validation_error(error_msg: str) -> dict[str, str]:
    """Analyze validation error messages to provide category, severity, and suggested fix."""
    msg_lower = error_msg.lower()

    # Defaults
    category = "schema_component"
    severity = "error"
    suggested_fix = "Adjust component properties to match the schema definitions for this component type."

    # Topology errors
    if any(k in msg_lower for k in ("circular", "orphan", "reachable", "topology")):
        category = "topology"
        severity = "error"
        suggested_fix = "Check component parent/child reference IDs to ensure no cyclic or orphan relationships exist."

    # Integrity errors
    elif any(k in msg_lower for k in ("integrity", "unique", "duplicate", "must exist", "root component", "does not exist")):
        category = "integrity"
        severity = "error"
        suggested_fix = "Ensure component IDs are unique, references point to existing components, and a component with ID 'root' exists."

    # Schema Structure (message level / JSON level)
    elif any(k in msg_lower for k in ("is not an object", "unknown message type", "json", "syntax", "no a2ui json")):
        category = "schema_structure"
        severity = "error"
        suggested_fix = "Verify the format of the output and ensure it is correctly enclosed in <a2ui-json>...</a2ui-json> tags."

    # Schema Hallucination (made up elements/properties)
    elif any(k in msg_lower for k in ("additional properties", "unevaluated properties", "not allowed", "unknown key")):
        category = "schema_hallucination"
        severity = "warning"
        suggested_fix = "Remove additional or hallucinated properties that are not supported by the catalog schema."

    return {
        "category": category,
        "severity": severity,
        "suggestedFix": suggested_fix,
    }


class A2uiProtocolAdapter:
    """Thin wrapper around the A2UI SDK-backed parsing and validation flow."""

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
                    "issues": [{
                        "message": error,
                        "category": "schema_structure",
                        "severity": "error",
                        "suggestedFix": "Verify the format of the output and ensure it is correctly enclosed in <a2ui-json>...</a2ui-json> tags."
                    }],
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
                analysis = analyze_validation_error(err)
                issues.append({
                    "message": err,
                    "category": analysis["category"],
                    "severity": analysis["severity"],
                    "suggestedFix": analysis["suggestedFix"],
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
            spec_version=selection.protocol_version,
            protocol_id="a2ui",
            protocol_version=selection.protocol_version,
            protocol_profile_id=selection.protocol_profile_id,
            protocol_options=selection.protocol_options,
            catalog_profile_id=selection.catalog_profile_id,
            error=error,
            metadata={
                "protocolId": "a2ui",
                "protocolVersion": selection.protocol_version,
                "protocolProfileId": selection.protocol_profile_id,
                "catalogId": selection.catalog_id,
                "catalogProfileId": selection.catalog_profile_id,
                "description": selection.description,
                "target": selection.target,
            },
        )
