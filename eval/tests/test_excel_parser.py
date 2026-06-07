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

"""Unit tests for Excel test-set parser."""

from __future__ import annotations

import openpyxl
from pathlib import Path
from a2ui_eval.excel_parser import parse_excel_test_set


def test_excel_parser_parses_valid_sheet(tmp_path: Path):
    excel_path = tmp_path / "test_set.xlsx"
    wb = openpyxl.Workbook()
    sheet = wb.active
    sheet.title = "Starter Sheet"

    # Write headers
    sheet.append(
        [
            "Prompt",
            "Group",
            "Description",
            "Target",
            "Renderer",
            "Spec Version",
            "Catalog ID",
            "Catalog Profile ID",
        ]
    )
    # Row 1
    sheet.append(
        [
            "Render a card",
            "starter-group",
            "Card case",
            "Expect card",
            "ink",
            "0.9",
            "https://a2ui.org/catalog.json",
            "ink-a2ui-v0_9",
        ]
    )
    # Row 2
    sheet.append(
        [
            "Render a button",
            "",  # empty group -> should use sheet name slugified
            "Button case",
            "Expect button",
            "react",
            "0.8",
            "",
            "",
        ]
    )

    wb.save(str(excel_path))

    groups = parse_excel_test_set(excel_path)
    # We should have two groups: "starter-group" and "starter-sheet"
    assert len(groups) == 2

    # Map groups by ID for checking
    group_map = {g.group_id: g for g in groups}
    assert "starter-group" in group_map
    assert "starter-sheet" in group_map

    g1 = group_map["starter-group"]
    assert len(g1.cases) == 1
    c1 = g1.cases[0]
    assert c1.case_id == "case-1"
    assert c1.prompt == "Render a card"
    assert c1.renderer == "ink"
    assert c1.spec_version == "0.9"
    assert c1.catalog_id == "https://a2ui.org/catalog.json"
    assert c1.catalog_profile_id == "ink-a2ui-v0_9"

    g2 = group_map["starter-sheet"]
    assert len(g2.cases) == 1
    c2 = g2.cases[0]
    assert c2.case_id == "case-2"
    assert c2.prompt == "Render a button"
    assert c2.renderer == "react"
    assert c2.spec_version == "0.8"
    assert c2.catalog_id is None
    assert c2.catalog_profile_id is None
