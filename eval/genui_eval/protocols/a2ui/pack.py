# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

"""A2UI protocol pack implementation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.manager import A2uiSchemaManager

from genui_eval.protocols.base import ProtocolProfile, ResolvedProtocolConfig
from genui_eval.studio_types import StudioCaseResult, StudioCaseSelection, StudioRunDefinition

from .adapter import A2uiProtocolAdapter
from .catalog_registry import CatalogRegistry, ResolvedCatalogConfig


class A2uiProtocolPack:
    """Protocol pack that preserves the existing A2UI eval behavior."""

    protocol_id = "a2ui"

    def __init__(self, studio_root: Path, repo_root: Path):
        self.catalog_registry = CatalogRegistry(studio_root, repo_root)
        self.catalog_registry.load()
        self._adapter_cache: dict[str, A2uiProtocolAdapter] = {}

    def validate_profile(self, profile: ProtocolProfile) -> list[str]:
        errors: list[str] = []
        catalog_profile_id = self._catalog_profile_id(profile)
        try:
            self.catalog_registry.resolve_profile(catalog_profile_id)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            errors.append(
                f"A2UI catalog profile '{catalog_profile_id}' could not be resolved: {exc}"
            )
        return errors

    def resolve_profile(self, profile: ProtocolProfile) -> ResolvedProtocolConfig:
        catalog_profile = self.catalog_registry.resolve_profile(self._catalog_profile_id(profile))
        options = dict(profile.protocol_options)
        options["catalogProfileId"] = catalog_profile.profile_id
        return ResolvedProtocolConfig(
            profile=profile,
            pack=self,
            protocol_options=options,
            pack_config=catalog_profile,
        )

    def validate_case(
        self,
        run_definition: StudioRunDefinition,
        case: StudioCaseSelection,
        config: ResolvedProtocolConfig,
    ) -> list[str]:
        errors: list[str] = []
        catalog_config = self._catalog_config(config)

        if case.catalog_id and case.catalog_id != catalog_config.catalog_id:
            errors.append(
                f"Case '{case.case_id}' catalog ID '{case.catalog_id}' does not match "
                f"resolved A2UI catalog profile '{catalog_config.profile_id}' catalog ID "
                f"'{catalog_config.catalog_id}'"
            )

        renderer = case.renderer or run_definition.renderer
        if renderer not in catalog_config.renderer_support:
            errors.append(
                f"Case '{case.case_id}' selected renderer '{renderer}' is not supported "
                f"by A2UI catalog profile '{catalog_config.profile_id}'. Supported renderers: "
                f"{catalog_config.renderer_support}"
            )

        protocol_version = case.protocol_version or run_definition.protocol_version
        if protocol_version != catalog_config.spec_version:
            errors.append(
                f"Case '{case.case_id}' requested A2UI protocol version '{protocol_version}' "
                f"does not match catalog profile '{catalog_config.profile_id}' spec version "
                f"'{catalog_config.spec_version}'"
            )

        if protocol_version not in ("0.8", "0.9"):
            errors.append(
                f"Case '{case.case_id}' requested unsupported A2UI protocol version "
                f"'{protocol_version}'. Supported versions are: '0.8', '0.9'"
            )

        return errors

    def build_prompt(self, case: StudioCaseSelection, config: ResolvedProtocolConfig) -> str:
        catalog_config = self._catalog_config(config)
        catalog = CatalogConfig.from_path(catalog_config.profile_id, str(catalog_config.catalog_schema_path))
        manager = A2uiSchemaManager(version=catalog_config.spec_version, catalogs=[catalog])
        workflow_override = f"""
Additional Rules:
1. Generate a 'createSurface' message with surfaceId 'main' and catalogId '{catalog_config.catalog_id}'.
2. Generate an 'updateComponents' message with surfaceId 'main' containing the requested UI.
3. Among the 'updateComponents' messages in the output, there MUST be one root component with id: 'root'.
4. Ensure all component children are referenced by ID, NOT nested inline as objects.
"""
        return manager.generate_system_prompt(
            role_description=(
                "You are an AI assistant. Based on the following request, generate a stream "
                "of JSON messages that conform to the provided JSON Schemas."
            ),
            workflow_description=workflow_override,
            include_schema=True,
        )

    def evaluate_case(
        self,
        run_id: str,
        selection: StudioCaseSelection,
        completion: str,
        config: ResolvedProtocolConfig,
    ) -> StudioCaseResult:
        catalog_config = self._catalog_config(config)
        selection.protocol_id = self.protocol_id
        selection.protocol_version = config.protocol_version
        selection.protocol_profile_id = config.protocol_profile_id
        selection.protocol_options = dict(config.protocol_options)
        selection.spec_version = config.protocol_version
        selection.catalog_profile_id = catalog_config.profile_id
        selection.catalog_id = catalog_config.catalog_id

        adapter = self._adapter_cache.get(catalog_config.profile_id)
        if adapter is None:
            adapter = A2uiProtocolAdapter(resolved_config=catalog_config)
            self._adapter_cache[catalog_config.profile_id] = adapter
        return adapter.evaluate_case(run_id=run_id, selection=selection, completion=completion)

    def _catalog_profile_id(self, profile: ProtocolProfile) -> str:
        return str(profile.protocol_options.get("catalogProfileId") or "a2ui-basic-v0_9")

    def _catalog_config(self, config: ResolvedProtocolConfig) -> ResolvedCatalogConfig:
        if not isinstance(config.pack_config, ResolvedCatalogConfig):
            raise TypeError("A2UI protocol config is missing a resolved catalog config")
        return config.pack_config

