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

"""Excel test-set parser for A2UI Eval Studio."""

from __future__ import annotations

import openpyxl
from pathlib import Path
from typing import Any

from .studio_types import StudioCaseSelection, StudioGroupSelection


def parse_excel_test_set(file_path: Path) -> list[StudioGroupSelection]:
    """Parse a .xlsx test set file into structured groups and cases."""

    wb = openpyxl.load_workbook(str(file_path), data_only=True)
    groups: dict[str, list[StudioCaseSelection]] = {}
    group_labels: dict[str, str] = {}
    case_idx = 1

    for sheet in wb.worksheets:
        sheet_name = sheet.title
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        # Find header columns in first row
        header = [
            str(cell).strip().lower().replace(" ", "").replace("_", "").replace("-", "") if cell is not None else ""
            for cell in rows[0]
        ]

        def get_col_idx(names: list[str]) -> int | None:
            for name in names:
                normalized_name = name.lower().replace(" ", "").replace("_", "").replace("-", "")
                if normalized_name in header:
                    return header.index(normalized_name)
            return None

        prompt_col = get_col_idx(["prompt", "prompt_text", "提示词"])
        if prompt_col is None:
            import logging
            logging.getLogger(__name__).warning(
                f"Skipping sheet '{sheet_name}' because no 'prompt' column was found. "
                f"Headers found: {header}"
            )
            continue

        case_id_col = get_col_idx(["case_id", "caseid", "id", "用例id"])
        group_col = get_col_idx(["group", "group_id", "groupid", "分组"])
        desc_col = get_col_idx(["description", "desc", "描述"])
        target_col = get_col_idx(["target", "expected", "target_criteria", "预期结果"])
        context_col = get_col_idx(["context", "extra_context", "上下文"])
        spec_col = get_col_idx(["spec_version", "specversion", "spec", "协议版本"])
        renderer_col = get_col_idx(["renderer", "渲染器"])
        catalog_id_col = get_col_idx(["catalog_id", "catalogid", "组件库id"])
        profile_col = get_col_idx(["catalog_profile_id", "profile_id", "profile", "配置模板"])

        for row in rows[1:]:
            if not row or len(row) <= prompt_col:
                continue

            prompt = row[prompt_col]
            if prompt is None or not str(prompt).strip():
                continue

            prompt_str = str(prompt).strip()

            raw_case_id = (
                row[case_id_col]
                if case_id_col is not None and len(row) > case_id_col
                else None
            )
            case_id = str(raw_case_id).strip() if raw_case_id else f"case-{case_idx}"
            case_idx += 1

            raw_group = (
                row[group_col]
                if group_col is not None and len(row) > group_col
                else None
            )
            group_id = (
                str(raw_group).strip().lower().replace(" ", "-")
                if raw_group
                else sheet_name.lower().replace(" ", "-")
            )
            group_label = str(raw_group).strip() if raw_group else sheet_name

            desc = (
                str(row[desc_col]).strip()
                if desc_col is not None and len(row) > desc_col and row[desc_col] is not None
                else None
            )
            target = (
                str(row[target_col]).strip()
                if target_col is not None and len(row) > target_col and row[target_col] is not None
                else None
            )
            context = (
                str(row[context_col]).strip()
                if context_col is not None and len(row) > context_col and row[context_col] is not None
                else None
            )
            spec_version = (
                str(row[spec_col]).strip()
                if spec_col is not None and len(row) > spec_col and row[spec_col] is not None
                else "0.9"
            )
            renderer = (
                str(row[renderer_col]).strip()
                if renderer_col is not None and len(row) > renderer_col and row[renderer_col] is not None
                else "react"
            )
            catalog_id = (
                str(row[catalog_id_col]).strip()
                if catalog_id_col is not None and len(row) > catalog_id_col and row[catalog_id_col] is not None
                else None
            )
            catalog_profile_id = (
                str(row[profile_col]).strip()
                if profile_col is not None and len(row) > profile_col and row[profile_col] is not None
                else None
            )

            case = StudioCaseSelection(
                case_id=case_id,
                prompt=prompt_str,
                group_id=group_id,
                description=desc,
                context=context,
                target=target,
                spec_version=spec_version,
                renderer=renderer,
                catalog_id=catalog_id,
                catalog_profile_id=catalog_profile_id,
            )

            groups.setdefault(group_id, []).append(case)
            group_labels[group_id] = group_label

    result = []
    for g_id, cases in groups.items():
        result.append(
            StudioGroupSelection(
                group_id=g_id,
                label=group_labels.get(g_id, g_id),
                cases=cases,
            )
        )
    return result


if __name__ == "__main__":
    import sys
    import json
    from a2ui_eval.studio_types import to_jsonable
    if len(sys.argv) < 2:
        print("Usage: python -m a2ui_eval.excel_parser <file_path>")
        sys.exit(1)
    try:
        parsed_groups = parse_excel_test_set(Path(sys.argv[1]))
        print(json.dumps(to_jsonable(parsed_groups), indent=2, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
