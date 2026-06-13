# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.

"""Protocol registry and profile resolution for GenUI Eval Studio."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from genui_eval.protocols.a2ui import A2uiProtocolPack
from genui_eval.protocols.base import ProtocolPack, ProtocolProfile, ResolvedProtocolConfig
from genui_eval.protocols.openui import OpenuiProtocolPack
from genui_eval.studio_types import StudioCaseSelection, StudioRunDefinition


class ProtocolRegistry:
    """Loads protocol profiles and resolves them to protocol pack configs."""

    def __init__(self, studio_root: Path, repo_root: Path):
        self.studio_root = Path(studio_root)
        self.repo_root = Path(repo_root)
        self.config_dir = self.studio_root / "config" / "protocols"
        self.profiles_dir = self.config_dir / "profiles"
        self._profiles: dict[str, ProtocolProfile] = {}
        self._default_profile_id = "a2ui-basic-v0_9"
        self._packs: dict[str, ProtocolPack] = {
            "a2ui": A2uiProtocolPack(self.studio_root, self.repo_root),
            "openui": OpenuiProtocolPack(),
        }

    @property
    def default_profile_id(self) -> str:
        return self._default_profile_id

    def ensure_seeded(self) -> None:
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        registry_path = self.config_dir / "registry.json"
        profiles = [
            ProtocolProfile(
                profile_id="a2ui-basic-v0_9",
                protocol_id="a2ui",
                protocol_version="0.9",
                adapter_id="genui_eval.protocols.a2ui",
                renderer_support=["react"],
                provenance={"source": "builtin-a2ui-basic-v0_9"},
                protocol_options={"catalogProfileId": "a2ui-basic-v0_9"},
            ),
            ProtocolProfile(
                profile_id="a2ui-ink-v0_9",
                protocol_id="a2ui",
                protocol_version="0.9",
                adapter_id="genui_eval.protocols.a2ui",
                renderer_support=["ink"],
                provenance={"source": "builtin-a2ui-ink-v0_9"},
                protocol_options={"catalogProfileId": "ink-a2ui-v0_9"},
            ),
            ProtocolProfile(
                profile_id="openui-default-v1",
                protocol_id="openui",
                protocol_version="1",
                adapter_id="genui_eval.protocols.openui",
                renderer_support=["json", "react"],
                provenance={"source": "openui-skeleton-v1"},
                protocol_options={},
            ),
        ]

        for profile in profiles:
            profile_path = self.profiles_dir / f"{profile.profile_id}.json"
            if not profile_path.exists():
                profile_path.write_text(
                    json.dumps(asdict(profile), indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )

        if registry_path.exists():
            try:
                registry_data = json.loads(registry_path.read_text(encoding="utf-8"))
            except Exception:  # pylint: disable=broad-exception-caught
                registry_data = {}
        else:
            registry_data = {}

        registered = set(registry_data.get("profiles") or [])
        registered.update(profile.profile_id for profile in profiles)
        registry_data["default_profile_id"] = registry_data.get(
            "default_profile_id", self._default_profile_id
        )
        registry_data["profiles"] = sorted(registered)
        registry_path.write_text(
            json.dumps(registry_data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def load(self) -> None:
        self.ensure_seeded()
        registry_path = self.config_dir / "registry.json"
        registry_data = json.loads(registry_path.read_text(encoding="utf-8"))
        self._default_profile_id = registry_data.get("default_profile_id", "a2ui-basic-v0_9")
        self._profiles.clear()
        for profile_id in registry_data.get("profiles", []):
            profile_path = self.profiles_dir / f"{profile_id}.json"
            if profile_path.exists():
                data = json.loads(profile_path.read_text(encoding="utf-8"))
                self._profiles[profile_id] = ProtocolProfile.from_dict(data)

    def get_profile(self, profile_id: str) -> ProtocolProfile | None:
        return self._profiles.get(profile_id)

    def resolve_profile(self, profile_id: str) -> ResolvedProtocolConfig:
        profile = self.get_profile(profile_id)
        if profile is None:
            raise ValueError(f"Protocol profile '{profile_id}' not found in registry.")
        pack = self._packs.get(profile.protocol_id)
        if pack is None:
            raise ValueError(f"Protocol pack '{profile.protocol_id}' is not registered.")
        profile_errors = pack.validate_profile(profile)
        if profile_errors:
            raise ValueError("; ".join(profile_errors))
        return pack.resolve_profile(profile)

    def resolve_for_case(
        self,
        run_definition: StudioRunDefinition,
        case: StudioCaseSelection,
    ) -> ResolvedProtocolConfig:
        profile_id = case.protocol_profile_id or run_definition.protocol_profile_id
        if not profile_id:
            catalog_profile_id = case.catalog_profile_id or run_definition.catalog_profile_id
            profile_id = self._profile_id_for_a2ui_catalog(catalog_profile_id)
        return self.resolve_profile(profile_id)

    def validate_case(
        self,
        run_definition: StudioRunDefinition,
        case: StudioCaseSelection,
    ) -> list[str]:
        try:
            config = self.resolve_for_case(run_definition, case)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            profile_id = case.protocol_profile_id or run_definition.protocol_profile_id
            return [f"Case '{case.case_id}' protocol profile '{profile_id}' could not be resolved: {exc}"]
        return config.pack.validate_case(run_definition, case, config)

    def _profile_id_for_a2ui_catalog(self, catalog_profile_id: str | None) -> str:
        if not catalog_profile_id:
            return self.default_profile_id
        if catalog_profile_id in self._profiles:
            return catalog_profile_id
        for profile in self._profiles.values():
            if (
                profile.protocol_id == "a2ui"
                and profile.protocol_options.get("catalogProfileId") == catalog_profile_id
            ):
                return profile.profile_id
        return catalog_profile_id
