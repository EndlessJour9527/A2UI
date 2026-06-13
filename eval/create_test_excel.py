import openpyxl
from pathlib import Path

def main():
    dest_dir = Path("/Users/next/develop/ai-proj/A2UI/eval/datasets")
    dest_dir.mkdir(parents=True, exist_ok=True)
    excel_path = dest_dir / "sample_test_cases.xlsx"
    
    wb = openpyxl.Workbook()
    sheet = wb.active
    sheet.title = "Test Cases"
    
    # Write headers
    sheet.append([
        "Prompt",
        "Group",
        "Description",
        "Target",
        "Renderer",
        "Spec Version",
        "Catalog ID",
        "Catalog Profile ID"
    ])
    
    # Row 1
    sheet.append([
        "Render a card with a title 'Hello' and a subtitle 'World'",
        "ui-test-group",
        "Card layout test",
        "Expect a card container containing title 'Hello' and subtitle 'World'",
        "react",
        "0.9",
        "",
        ""
    ])
    
    # Row 2
    sheet.append([
        "Render a success button with label 'Submit'",
        "ui-test-group",
        "Button design test",
        "Expect a success themed button styled with label 'Submit'",
        "react",
        "0.9",
        "",
        ""
    ])
    
    wb.save(str(excel_path))
    print(f"Created Excel file at: {excel_path}")

if __name__ == "__main__":
    main()
