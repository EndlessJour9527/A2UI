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

"""Catalog registry and profile resolution for A2UI Eval Studio."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


@dataclass
class CatalogProfile:
    """Metadata and paths defining a single catalog profile."""

    profile_id: str
    catalog_id: str
    spec_version: str
    catalog_schema_path: str
    server_to_client_schema_path: str | None = None
    common_types_schema_path: str | None = None
    renderer_support: list[str] = field(default_factory=list)
    validation_policy: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CatalogProfile:
        return cls(
            profile_id=data["profile_id"],
            catalog_id=data["catalog_id"],
            spec_version=data["spec_version"],
            catalog_schema_path=data["catalog_schema_path"],
            server_to_client_schema_path=data.get("server_to_client_schema_path"),
            common_types_schema_path=data.get("common_types_schema_path"),
            renderer_support=data.get("renderer_support") or [],
            validation_policy=data.get("validation_policy") or {},
            provenance=data.get("provenance") or {},
        )


@dataclass(frozen=True)
class ResolvedCatalogConfig:
    """Resolved schema and metadata for validator initialization and tracking."""

    profile_id: str
    catalog_id: str
    spec_version: str
    catalog_schema_path: Path
    catalog_schema: dict[str, Any]
    server_to_client_schema: dict[str, Any] | None = None
    common_types_schema: dict[str, Any] | None = None
    renderer_support: list[str] = field(default_factory=list)
    validation_policy: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)


class CatalogRegistry:
    """Loads, saves, and resolves catalog profiles from the local filesystem."""

    def __init__(self, studio_root: Path, repo_root: Path):
        self.studio_root = Path(studio_root)
        self.repo_root = Path(repo_root)
        self.config_dir = self.studio_root / "config" / "catalogs"
        self.profiles_dir = self.config_dir / "profiles"
        self._profiles: dict[str, CatalogProfile] = {}
        self._default_profile_id: str = "a2ui-basic-v0_9"

    def ensure_seeded(self) -> None:
        """Ensure config directory exists and seeds the default basic profile if empty."""
        self.profiles_dir.mkdir(parents=True, exist_ok=True)
        registry_path = self.config_dir / "registry.json"

        # Define default basic profile pointing to the spec's basic catalog
        basic_catalog_rel = "specification/v0_9/catalogs/basic/catalog.json"
        
        default_profile = CatalogProfile(
            profile_id="a2ui-basic-v0_9",
            catalog_id="https://a2ui.org/specification/v0_9/basic_catalog.json",
            spec_version="0.9",
            catalog_schema_path=basic_catalog_rel,
            renderer_support=["react"],
            provenance={"source": "builtin-spec-v0_9"},
        )

        if not registry_path.exists():
            registry_data = {
                "default_profile_id": default_profile.profile_id,
                "profiles": [default_profile.profile_id],
            }
            registry_path.write_text(json.dumps(registry_data, indent=2) + "\n", encoding="utf-8")

        profile_path = self.profiles_dir / f"{default_profile.profile_id}.json"
        if not profile_path.exists():
            profile_path.write_text(json.dumps(asdict(default_profile), indent=2) + "\n", encoding="utf-8")

    def load(self) -> None:
        """Load all profiles registered in registry.json."""
        self.ensure_seeded()
        registry_path = self.config_dir / "registry.json"
        try:
            registry_data = json.loads(registry_path.read_text(encoding="utf-8"))
            self._default_profile_id = registry_data.get("default_profile_id", "a2ui-basic-v0_9")
            registered_ids = registry_data.get("profiles", [])
            for profile_id in registered_ids:
                profile_path = self.profiles_dir / f"{profile_id}.json"
                if profile_path.exists():
                    profile_data = json.loads(profile_path.read_text(encoding="utf-8"))
                    self._profiles[profile_id] = CatalogProfile.from_dict(profile_data)
        except Exception as exc:
            # Fallback in case of corruption
            default_catalog_rel = "specification/v0_9/catalogs/basic/catalog.json"
            self._profiles["a2ui-basic-v0_9"] = CatalogProfile(
                profile_id="a2ui-basic-v0_9",
                catalog_id="https://a2ui.org/specification/v0_9/basic_catalog.json",
                spec_version="0.9",
                catalog_schema_path=default_catalog_rel,
                renderer_support=["react"],
            )

    @property
    def default_profile_id(self) -> str:
        return self._default_profile_id

    def get_profile(self, profile_id: str) -> CatalogProfile | None:
        return self._profiles.get(profile_id)

    def add_profile(self, profile: CatalogProfile) -> None:
        """Register and save a new catalog profile."""
        self.ensure_seeded()
        self._profiles[profile.profile_id] = profile
        
        # Save profile file
        profile_path = self.profiles_dir / f"{profile.profile_id}.json"
        profile_path.write_text(json.dumps(asdict(profile), indent=2) + "\n", encoding="utf-8")

        # Update registry.json
        registry_path = self.config_dir / "registry.json"
        registry_data = {
            "default_profile_id": self._default_profile_id,
            "profiles": sorted(list(self._profiles.keys())),
        }
        registry_path.write_text(json.dumps(registry_data, indent=2) + "\n", encoding="utf-8")

    def resolve_profile(self, profile_id: str) -> ResolvedCatalogConfig:
        """Resolve a profile ID into a concrete config with loaded JSON schemas."""
        profile = self.get_profile(profile_id)
        if not profile:
            raise ValueError(f"Catalog profile '{profile_id}' not found in registry.")

        # Resolve paths relative to repo root if they are relative
        schema_path = Path(profile.catalog_schema_path)
        if not schema_path.is_absolute():
            schema_path = self.repo_root / schema_path

        if not schema_path.exists():
            raise FileNotFoundError(f"Catalog schema file not found: {schema_path}")

        catalog_schema = json.loads(schema_path.read_text(encoding="utf-8"))

        s2c_schema = None
        if profile.server_to_client_schema_path:
            s2c_path = Path(profile.server_to_client_schema_path)
            if not s2c_path.is_absolute():
                s2c_path = self.repo_root / s2c_path
            if s2c_path.exists():
                s2c_schema = json.loads(s2c_path.read_text(encoding="utf-8"))

        common_schema = None
        if profile.common_types_schema_path:
            common_path = Path(profile.common_types_schema_path)
            if not common_path.is_absolute():
                common_path = self.repo_root / common_path
            if common_path.exists():
                common_schema = json.loads(common_path.read_text(encoding="utf-8"))

        return ResolvedCatalogConfig(
            profile_id=profile.profile_id,
            catalog_id=profile.catalog_id,
            spec_version=profile.spec_version,
            catalog_schema_path=schema_path,
            catalog_schema=catalog_schema,
            server_to_client_schema=s2c_schema,
            common_types_schema=common_schema,
            renderer_support=profile.renderer_support,
            validation_policy=profile.validation_policy,
            provenance=profile.provenance,
        )

    def resolve_by_catalog_id(self, catalog_id: str, version: str = "0.9") -> ResolvedCatalogConfig:
        """Attempt to find a registered profile matching the A2UI catalog_id and spec version."""
        for profile in self._profiles.values():
            if profile.catalog_id == catalog_id and profile.spec_version == version:
                return self.resolve_profile(profile.profile_id)
        raise ValueError(f"No catalog profile matching catalog_id '{catalog_id}' and version '{version}' is registered.")
