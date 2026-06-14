#!/usr/bin/env python3
"""Delegate a plan to local Antigravity through a configurable CLI wrapper."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Iterable


STATES = {"queued", "running", "completed", "failed", "blocked"}
DEFAULT_COMMANDS = ("agy", "antigravity", "antigravity-cli", "ag")


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def slugify(value: str) -> str:
    chars = []
    previous_dash = False
    for char in value.lower():
        if char.isalnum():
            chars.append(char)
            previous_dash = False
        elif not previous_dash:
            chars.append("-")
            previous_dash = True
    slug = "".join(chars).strip("-")
    return slug[:48] or "task"


def write_status(path: Path, **updates: object) -> None:
    status = {}
    if path.exists():
        status = json.loads(path.read_text(encoding="utf-8"))
    status.update(updates)
    status["updated_at"] = utc_now()
    path.write_text(json.dumps(status, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def resolve_command() -> tuple[list[str] | None, str | None]:
    template = os.environ.get("ANTIGRAVITY_COMMAND_TEMPLATE")
    if template:
        return shlex.split(template), "ANTIGRAVITY_COMMAND_TEMPLATE"

    configured = os.environ.get("ANTIGRAVITY_CLI")
    if configured:
        return shlex.split(configured), "ANTIGRAVITY_CLI"

    for command in DEFAULT_COMMANDS:
        found = shutil.which(command)
        if found:
            return [found], f"PATH:{command}"
    return None, None


def render_template(parts: Iterable[str], values: dict[str, str]) -> list[str]:
    return [part.format(**values) for part in parts]


def build_command(
    command: list[str],
    values: dict[str, str],
    timeout_seconds: int,
    additional_dirs: list[str] | None = None,
) -> tuple[list[str], str | None]:
    rendered = render_template(command, values)
    executable = Path(rendered[0]).name
    if executable == "agy":
        cmd = rendered + [
            "--print",
            "--add-dir",
            values["cwd"],
        ]
        if additional_dirs:
            for d in additional_dirs:
                cmd.extend(["--add-dir", d])
        cmd.extend([
            "--log-file",
            str(Path(values["task_dir"]) / "agy.log"),
            "--print-timeout",
            f"{timeout_seconds}s",
            f"Use the plan at {values['plan_file']} and work in {values['cwd']}. "
            f"Do not ask follow-up questions. Do not produce a step-by-step exploration transcript. "
            f"Read the plan, perform only the work required by that plan, and write a concise final execution "
            f"report to {values['result_file']}. If the task is unsafe or ambiguous, report that briefly and stop.",
        ])
        return cmd, None
    return rendered, Path(values["plan_file"]).read_text(encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", required=True, help="Repository working directory for Antigravity.")
    parser.add_argument("--plan-file", required=True, help="Markdown plan file to delegate.")
    parser.add_argument("--task-title", required=True, help="Human-readable task title.")
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=3600,
        help="Maximum Antigravity execution time. Defaults to 3600.",
    )
    parser.add_argument(
        "--status-dir",
        default=".antigravity-tasks",
        help="Directory for task status and logs, relative to --cwd unless absolute.",
    )
    parser.add_argument(
        "--add-dir",
        action="append",
        default=[],
        help="Additional directories to add to the workspace scope.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Create task files without invoking Antigravity.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cwd = Path(args.cwd).expanduser().resolve()
    plan_file = Path(args.plan_file).expanduser().resolve()
    if not cwd.is_dir():
        print(f"cwd does not exist or is not a directory: {cwd}", file=sys.stderr)
        return 2
    if not plan_file.is_file():
        print(f"plan file does not exist: {plan_file}", file=sys.stderr)
        return 2

    additional_dirs = []
    for d in args.add_dir:
        resolved_d = Path(d).expanduser()
        if not resolved_d.is_absolute():
            resolved_d = (cwd / resolved_d).resolve()
        else:
            resolved_d = resolved_d.resolve()
        if not resolved_d.is_dir():
            print(f"Additional directory does not exist or is not a directory: {resolved_d}", file=sys.stderr)
            return 2
        additional_dirs.append(str(resolved_d))

    status_root = Path(args.status_dir).expanduser()
    if not status_root.is_absolute():
        status_root = cwd / status_root
    task_id = f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(args.task_title)}-{uuid.uuid4().hex[:8]}"
    task_dir = status_root / task_id
    task_dir.mkdir(parents=True, exist_ok=False)

    delegated_plan = task_dir / "plan.md"
    status_file = task_dir / "status.json"
    stdout_file = task_dir / "stdout.log"
    stderr_file = task_dir / "stderr.log"
    result_file = task_dir / "result.md"
    delegated_plan.write_text(plan_file.read_text(encoding="utf-8"), encoding="utf-8")
    stdout_file.write_text("", encoding="utf-8")
    stderr_file.write_text("", encoding="utf-8")
    result_file.write_text("# Antigravity Result\n\nNo result has been reported yet.\n", encoding="utf-8")

    command, command_source = resolve_command()
    base_status = {
        "task_id": task_id,
        "task_title": args.task_title,
        "state": "queued",
        "created_at": utc_now(),
        "cwd": str(cwd),
        "add_dir": additional_dirs,
        "task_dir": str(task_dir),
        "plan_file": str(delegated_plan),
        "stdout_log": str(stdout_file),
        "stderr_log": str(stderr_file),
        "result_file": str(result_file),
        "timeout_seconds": args.timeout_seconds,
        "command_source": command_source,
        "command": command,
        "dry_run": args.dry_run,
    }
    write_status(status_file, **base_status)

    values = {
        "plan_file": str(delegated_plan),
        "cwd": str(cwd),
        "task_title": args.task_title,
        "task_id": task_id,
        "task_dir": str(task_dir),
        "result_file": str(result_file),
    }

    if not command:
        write_status(
            status_file,
            state="blocked",
            error="No Antigravity command found. Set ANTIGRAVITY_COMMAND_TEMPLATE or ANTIGRAVITY_CLI.",
        )
        print(json.dumps({"task_id": task_id, "state": "blocked", "task_dir": str(task_dir)}, indent=2))
        return 0 if args.dry_run else 3

    rendered_command, process_input = build_command(
        command,
        values,
        args.timeout_seconds,
        additional_dirs=additional_dirs,
    )
    write_status(status_file, command=rendered_command)

    if args.dry_run:
        result_file.write_text(
            "# Antigravity Result\n\nDry run only. Antigravity was not invoked.\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {
                    "task_id": task_id,
                    "state": "queued",
                    "task_dir": str(task_dir),
                    "command": rendered_command,
                    "dry_run": True,
                },
                indent=2,
            )
        )
        return 0

    write_status(status_file, state="running", started_at=utc_now())
    with stdout_file.open("w", encoding="utf-8") as stdout, stderr_file.open("w", encoding="utf-8") as stderr:
        try:
            process = subprocess.run(
                rendered_command,
                input=process_input,
                stdin=subprocess.DEVNULL if process_input is None else None,
                text=True,
                cwd=str(cwd),
                stdout=stdout,
                stderr=stderr,
                timeout=args.timeout_seconds,
                check=False,
            )
            final_state = "completed" if process.returncode == 0 else "failed"
            write_status(
                status_file,
                state=final_state,
                finished_at=utc_now(),
                returncode=process.returncode,
            )
            if result_file.read_text(encoding="utf-8").strip().endswith("No result has been reported yet."):
                stdout_text = stdout_file.read_text(encoding="utf-8").strip()
                if stdout_text:
                    result_file.write_text(stdout_text + "\n", encoding="utf-8")
                else:
                    result_file.write_text(
                        "# Antigravity Result\n\n"
                        f"Process exited with state `{final_state}` and return code `{process.returncode}`.\n"
                        f"See `{stdout_file}` and `{stderr_file}` for details.\n",
                        encoding="utf-8",
                    )
            print(json.dumps({"task_id": task_id, "state": final_state, "task_dir": str(task_dir)}, indent=2))
            return 0 if process.returncode == 0 else process.returncode
        except subprocess.TimeoutExpired:
            write_status(status_file, state="failed", finished_at=utc_now(), error="Antigravity command timed out.")
            stderr.write(f"Antigravity command timed out after {args.timeout_seconds} seconds.\n")
            print(json.dumps({"task_id": task_id, "state": "failed", "task_dir": str(task_dir)}, indent=2))
            return 124
        except KeyboardInterrupt:
            write_status(status_file, state="failed", finished_at=utc_now(), error="Antigravity command interrupted.")
            stderr.write("Antigravity command interrupted.\n")
            print(json.dumps({"task_id": task_id, "state": "failed", "task_dir": str(task_dir)}, indent=2))
            return 130
        except OSError as exc:
            write_status(status_file, state="failed", finished_at=utc_now(), error=str(exc))
            stderr.write(f"{exc}\n")
            print(json.dumps({"task_id": task_id, "state": "failed", "task_dir": str(task_dir)}, indent=2))
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
