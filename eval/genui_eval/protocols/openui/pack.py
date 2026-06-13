# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

"""OpenUI protocol pack skeleton for architecture validation."""

from __future__ import annotations

import json
from typing import Any

from genui_eval.protocols.base import ProtocolProfile, ResolvedProtocolConfig
from genui_eval.studio_types import (
    StudioCaseResult,
    StudioCaseSelection,
    StudioRunDefinition,
    StudioRunStatus,
)


class OpenuiProtocolPack:
    """Minimal OpenUI pack that captures raw output and normalizes it for Studio."""

    protocol_id = "openui"

    def validate_profile(self, profile: ProtocolProfile) -> list[str]:
        return []

    def resolve_profile(self, profile: ProtocolProfile) -> ResolvedProtocolConfig:
        return ResolvedProtocolConfig(
            profile=profile,
            pack=self,
            protocol_options=dict(profile.protocol_options),
            pack_config=None,
        )

    def validate_case(
        self,
        run_definition: StudioRunDefinition,
        case: StudioCaseSelection,
        config: ResolvedProtocolConfig,
    ) -> list[str]:
        renderer = case.renderer or run_definition.renderer
        if config.profile.renderer_support and renderer not in config.profile.renderer_support:
            return [
                f"Case '{case.case_id}' selected renderer '{renderer}' is not supported "
                f"by OpenUI protocol profile '{config.protocol_profile_id}'. Supported renderers: "
                f"{config.profile.renderer_support}"
            ]
        return []

    def build_prompt(self, case: StudioCaseSelection, config: ResolvedProtocolConfig) -> str:
        return (
            "Generate OpenUI-compatible UI output for the user's request. "
            "This Eval Studio adapter currently captures raw OpenUI output for review."
        )

    def evaluate_case(
        self,
        run_id: str,
        selection: StudioCaseSelection,
        completion: str,
        config: ResolvedProtocolConfig,
    ) -> StudioCaseResult:
        parsed_payload = self._parse_completion(completion)
        normalized = {
            "protocol": "openui",
            "profileId": config.protocol_profile_id,
            "payload": parsed_payload,
        }
        validation = {
            "pass": True,
            "errors": [],
            "explanation": "OpenUI skeleton adapter captured raw output; schema validation is not implemented yet.",
            "issues": [
                {
                    "message": "OpenUI schema validation is not implemented in this skeleton adapter.",
                    "category": "skeleton_validation",
                    "severity": "warning",
                    "suggestedFix": "Add an OpenUI schema validator when the OpenUI protocol contract is finalized.",
                }
            ],
        }

        selection.protocol_id = self.protocol_id
        selection.protocol_version = config.protocol_version
        selection.protocol_profile_id = config.protocol_profile_id
        selection.protocol_options = dict(config.protocol_options)
        selection.spec_version = config.protocol_version

        return StudioCaseResult(
            run_id=run_id,
            group_id=selection.group_id,
            case_id=selection.case_id,
            status=StudioRunStatus.COMPLETED,
            prompt=selection.prompt,
            raw_completion=completion,
            parsed_messages=[parsed_payload],
            normalized_messages=[normalized],
            validation=validation,
            semantic_evaluation={
                "grade": None,
                "pass": True,
                "issues": [],
            },
            renderer=selection.renderer,
            spec_version=selection.spec_version,
            protocol_id=self.protocol_id,
            protocol_version=config.protocol_version,
            protocol_profile_id=config.protocol_profile_id,
            protocol_options=dict(config.protocol_options),
            metadata={
                "protocolId": self.protocol_id,
                "protocolVersion": config.protocol_version,
                "protocolProfileId": config.protocol_profile_id,
                "description": selection.description,
                "target": selection.target,
            },
        )

    def _parse_completion(self, completion: str) -> Any:
        try:
            return json.loads(completion)
        except json.JSONDecodeError:
            return {"raw": completion}

