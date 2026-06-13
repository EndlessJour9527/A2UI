# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

"""Protocol pack contracts for GenUI Eval Studio."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from genui_eval.studio_types import StudioCaseResult, StudioCaseSelection, StudioRunDefinition


@dataclass(slots=True)
class ProtocolProfile:
    """Reusable protocol profile selected at run, group, or case level."""

    profile_id: str
    protocol_id: str
    protocol_version: str
    adapter_id: str
    renderer_support: list[str] = field(default_factory=list)
    prompt_policy: dict[str, Any] = field(default_factory=dict)
    validation_policy: dict[str, Any] = field(default_factory=dict)
    evidence_policy: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    protocol_options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProtocolProfile":
        return cls(
            profile_id=data["profile_id"],
            protocol_id=data["protocol_id"],
            protocol_version=data["protocol_version"],
            adapter_id=data["adapter_id"],
            renderer_support=data.get("renderer_support") or [],
            prompt_policy=data.get("prompt_policy") or {},
            validation_policy=data.get("validation_policy") or {},
            evidence_policy=data.get("evidence_policy") or {},
            provenance=data.get("provenance") or {},
            protocol_options=data.get("protocol_options") or {},
        )


@dataclass(frozen=True, slots=True)
class ResolvedProtocolConfig:
    """Resolved protocol profile and pack-specific runtime data."""

    profile: ProtocolProfile
    pack: "ProtocolPack"
    protocol_options: dict[str, Any] = field(default_factory=dict)
    pack_config: Any = None

    @property
    def protocol_id(self) -> str:
        return self.profile.protocol_id

    @property
    def protocol_version(self) -> str:
        return self.profile.protocol_version

    @property
    def protocol_profile_id(self) -> str:
        return self.profile.profile_id


class ProtocolPack(Protocol):
    """Interface implemented by protocol-specific GenUI adapters."""

    protocol_id: str

    def validate_profile(self, profile: ProtocolProfile) -> list[str]:
        """Return planning errors for an invalid profile."""

    def resolve_profile(self, profile: ProtocolProfile) -> ResolvedProtocolConfig:
        """Resolve a profile into adapter-specific runtime config."""

    def validate_case(
        self,
        run_definition: StudioRunDefinition,
        case: StudioCaseSelection,
        config: ResolvedProtocolConfig,
    ) -> list[str]:
        """Return planning errors for a case under this protocol config."""

    def build_prompt(
        self,
        case: StudioCaseSelection,
        config: ResolvedProtocolConfig,
    ) -> str:
        """Build protocol-specific system prompt text."""

    def evaluate_case(
        self,
        run_id: str,
        selection: StudioCaseSelection,
        completion: str,
        config: ResolvedProtocolConfig,
    ) -> StudioCaseResult:
        """Parse, validate, and normalize one completion."""

