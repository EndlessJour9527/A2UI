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

"""Excel test-set parser for GenUI Eval Studio."""

from __future__ import annotations

import openpyxl
import json
from pathlib import Path

from .studio_types import StudioCaseSelection, StudioGroupSelection


def parse_json_test_set(file_path: Path) -> list[StudioGroupSelection]:
    """Parse a .json test set file into structured groups and cases."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    if not isinstance(data, list):
        raise ValueError("JSON test set must be a list at the top level.")
        
    def map_case(raw_case: dict, case_idx: int, default_group_id: str) -> StudioCaseSelection:
        def get_val(keys: list[str], default=None):
            for k in keys:
                if k in raw_case:
                    return raw_case[k]
            return default
            
        prompt = get_val(["prompt", "prompt_text", "promptText", "提示词"])
        if not prompt or not str(prompt).strip():
            raise ValueError(f"Case at index {case_idx} is missing a valid prompt.")
            
        prompt_str = str(prompt).strip()
        raw_case_id = get_val(["case_id", "caseId", "id", "用例id"])
        case_id = str(raw_case_id).strip() if raw_case_id else f"case-{case_idx}"
        
        group_id = get_val(["group_id", "groupId", "group", "分组"])
        if group_id:
            group_id = str(group_id).strip().lower().replace(" ", "-")
        else:
            group_id = default_group_id
            
        desc = get_val(["description", "desc", "描述"])
        if desc is not None:
            desc = str(desc).strip()
            
        target = get_val(["target", "expected", "target_criteria", "targetCriteria", "预期结果"])
        if target is not None:
            target = str(target).strip()
            
        context = get_val(["context", "extra_context", "extraContext", "上下文"])
        if context is not None:
            context = str(context).strip()
            
        spec_version = get_val(["spec_version", "specVersion", "spec", "协议版本"], "0.9")
        protocol_id = get_val(["protocol_id", "protocolId", "协议"], "a2ui")
        protocol_version = get_val(["protocol_version", "protocolVersion", "协议版本"], spec_version)
        protocol_profile_id = get_val(["protocol_profile_id", "protocolProfileId", "协议配置"])
        
        protocol_options = get_val(["protocol_options", "protocolOptions", "协议选项"], {})
        if isinstance(protocol_options, str):
            if protocol_options.strip():
                protocol_options = json.loads(protocol_options)
            else:
                protocol_options = {}
                
        renderer = get_val(["renderer", "渲染器"], "react")
        catalog_id = get_val(["catalog_id", "catalogId", "组件库id"])
        catalog_profile_id = get_val(["catalog_profile_id", "catalogProfileId", "profile_id", "profile", "配置模板"])
        
        if catalog_profile_id and "catalogProfileId" not in protocol_options:
            protocol_options["catalogProfileId"] = catalog_profile_id
            
        return StudioCaseSelection(
            case_id=case_id,
            prompt=prompt_str,
            group_id=group_id,
            description=desc,
            context=context,
            target=target,
            protocol_id=protocol_id,
            protocol_version=protocol_version,
            protocol_profile_id=protocol_profile_id,
            protocol_options=protocol_options,
            spec_version=spec_version,
            renderer=renderer,
            catalog_id=catalog_id,
            catalog_profile_id=catalog_profile_id,
        )

    is_group_list = False
    if len(data) > 0 and isinstance(data[0], dict):
        if "cases" in data[0] and isinstance(data[0]["cases"], list):
            is_group_list = True

    default_group_id = file_path.stem.lower().replace(" ", "-")

    if is_group_list:
        groups = []
        case_idx = 1
        for group_data in data:
            if not isinstance(group_data, dict):
                continue
            group_id = group_data.get("group_id") or group_data.get("groupId") or group_data.get("group", "default")
            group_id = str(group_id).strip().lower().replace(" ", "-")
            label = group_data.get("label") or group_data.get("group_label") or group_id
            cases_list = group_data.get("cases", [])
            cases = []
            for raw_case in cases_list:
                if not isinstance(raw_case, dict):
                    continue
                cases.append(map_case(raw_case, case_idx, group_id))
                case_idx += 1
            if cases:
                groups.append(StudioGroupSelection(group_id=group_id, label=label, cases=cases))
        return groups
    else:
        cases_by_group: dict[str, list[StudioCaseSelection]] = {}
        case_idx = 1
        for raw_case in data:
            if not isinstance(raw_case, dict):
                continue
            case = map_case(raw_case, case_idx, default_group_id)
            case_idx += 1
            cases_by_group.setdefault(case.group_id, []).append(case)
            
        result = []
        for g_id, cases in cases_by_group.items():
            result.append(
                StudioGroupSelection(
                    group_id=g_id,
                    label=g_id,
                    cases=cases,
                )
            )
        return result


def parse_excel_test_set(file_path: Path) -> list[StudioGroupSelection]:
    """Parse a .xlsx or .json test set file into structured groups and cases."""
    if file_path.suffix.lower() == ".json":
        return parse_json_test_set(file_path)

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
        protocol_id_col = get_col_idx(["protocol_id", "protocolid", "协议"])
        protocol_profile_col = get_col_idx(["protocol_profile_id", "protocolprofileid", "协议配置"])
        protocol_version_col = get_col_idx(["protocol_version", "protocolversion", "协议版本"])
        protocol_options_col = get_col_idx(["protocol_options", "protocoloptions", "协议选项"])
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
            protocol_id = (
                str(row[protocol_id_col]).strip()
                if protocol_id_col is not None and len(row) > protocol_id_col and row[protocol_id_col] is not None
                else "a2ui"
            )
            protocol_version = (
                str(row[protocol_version_col]).strip()
                if protocol_version_col is not None
                and len(row) > protocol_version_col
                and row[protocol_version_col] is not None
                else spec_version
            )
            protocol_profile_id = (
                str(row[protocol_profile_col]).strip()
                if protocol_profile_col is not None
                and len(row) > protocol_profile_col
                and row[protocol_profile_col] is not None
                else None
            )
            protocol_options = {}
            if (
                protocol_options_col is not None
                and len(row) > protocol_options_col
                and row[protocol_options_col] is not None
            ):
                raw_options = str(row[protocol_options_col]).strip()
                if raw_options:
                    protocol_options = json.loads(raw_options)
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
            if catalog_profile_id and "catalogProfileId" not in protocol_options:
                protocol_options["catalogProfileId"] = catalog_profile_id

            case = StudioCaseSelection(
                case_id=case_id,
                prompt=prompt_str,
                group_id=group_id,
                description=desc,
                context=context,
                target=target,
                protocol_id=protocol_id,
                protocol_version=protocol_version,
                protocol_profile_id=protocol_profile_id,
                protocol_options=protocol_options,
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
    from genui_eval.studio_types import to_jsonable
    if len(sys.argv) < 2:
        print("Usage: python -m genui_eval.excel_parser <file_path>")
        sys.exit(1)
    try:
        parsed_groups = parse_excel_test_set(Path(sys.argv[1]))
        print(json.dumps(to_jsonable(parsed_groups), indent=2, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
