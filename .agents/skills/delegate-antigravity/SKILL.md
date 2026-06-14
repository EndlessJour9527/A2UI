---
name: delegate-antigravity
description: Delegate a decision-complete implementation plan to a local Antigravity executor through a configurable CLI wrapper, track task status and logs, and return execution evidence for planner verification. Use when Codex has a concrete plan that should be executed by local Antigravity as a subagent while the planner remains responsible for review and validation.
---

# Delegate Antigravity

## Purpose

Use this skill when a plan is already specific enough for execution and the user wants local Antigravity to perform the implementation work. Keep the current planner responsible for task framing, safety constraints, final verification, and deciding whether the result is acceptable.

Read `references/agy-cli-capabilities.md` when you need the concrete `agy` surface area, or when you need to explain what `agy` can do as a subagent.

## Workflow

1. Confirm the plan is decision-complete: goal, allowed files or directories, constraints, validation commands, and expected completion evidence.
2. Write the plan to a temporary Markdown file or use an existing plan file.
3. Read `references/task-contract.md` before preparing the task if the plan lacks an explicit execution contract.
4. Run `scripts/delegate_antigravity.py` from the repository root.
5. Monitor the generated `.antigravity-tasks/<task-id>/status.json`, `stdout.log`, `stderr.log`, and `result.md`.
6. After Antigravity finishes, inspect the working tree, read the logs, run relevant verification commands, and summarize the planner's acceptance decision.

## agy as a Subagent

Treat `agy` as a terminal-first Antigravity subagent surface, not just a raw binary:

- It accepts natural-language task prompts and can run one-shot tasks with `--print`.
- It can resume or continue prior conversations with `--conversation` and `--continue`.
- It can scope work to specific directories with `--add-dir`.
- It supports a sandboxed mode with `--sandbox`.
- It exposes plugin and model management commands, but those are setup surfaces, not task-execution defaults.

Use `agy` for bounded execution tasks such as:

- implementing a narrow, decision-complete code change
- running focused repo exploration and summarizing findings
- performing validation commands and reporting results
- writing a concise execution artifact back to `result.md`

Do not rely on `agy` by default for:

- open-ended research with unclear stopping conditions
- broad autonomous refactors across unrelated files
- repo-wide write access when the working tree already contains unrelated user changes
- remote or destructive actions unless the task contract explicitly allows them

When delegating to `agy`, make the prompt explicit about:

- the working directory
- the exact plan file to follow
- the need to avoid follow-up questions
- the required final report destination
- the rule that the planner, not `agy`, decides whether the task is accepted

## CLI Wrapper

Prefer the wrapper script instead of invoking Antigravity directly:

```bash
python3 .agents/skills/delegate-antigravity/scripts/delegate_antigravity.py \
  --cwd /Users/next/develop/ai-proj/A2UI \
  --task-title "Implement planned change" \
  --plan-file /path/to/plan.md \
  --add-dir /optional/additional/directory
```

Use `--add-dir` (can be specified multiple times) to add extra directories to the workspace scope. Use `--dry-run` when checking the generated task package or when Antigravity is not configured.

The wrapper resolves the command in this order:

1. `ANTIGRAVITY_COMMAND_TEMPLATE`
2. `ANTIGRAVITY_CLI`
3. Commands on `PATH`: `agy`, `antigravity`, `antigravity-cli`, `ag`

If `ANTIGRAVITY_COMMAND_TEMPLATE` is set, it may include these placeholders:

- `{plan_file}`
- `{cwd}`
- `{task_title}`
- `{task_id}`
- `{task_dir}`
- `{result_file}`

If `agy` is discovered, the wrapper invokes it with `--print`, adds `--add-dir {cwd}`, and writes the CLI log to `{task_dir}/agy.log`.

If only `ANTIGRAVITY_CLI` or another discovered command is available, the wrapper invokes it with the plan on stdin.

## Task States

Treat task states as:

- `queued`: task package exists but execution has not started
- `running`: wrapper has started the Antigravity process
- `completed`: process exited with status 0
- `failed`: process exited non-zero or the wrapper hit an execution error
- `blocked`: no Antigravity command is configured or discoverable

Do not treat `completed` as accepted. The planner must still inspect diffs, logs, and verification output.

## Planner Review

After execution:

- Check `git status --short` and inspect only files relevant to the task.
- Read `result.md`, `stdout.log`, and `stderr.log`.
- Run the validation commands from the original plan when practical.
- Report whether the result is accepted, needs follow-up, or is blocked.
- Do not commit, push, reset, or overwrite unrelated user changes unless the user explicitly asks.
