# agy CLI Capabilities

This note summarizes the `agy` CLI surface that matters for this skill.

## Core Modes

Use `agy` in these primary ways:

- `--print` or `--prompt`: run a single prompt non-interactively and print the response
- `--prompt-interactive`: start an interactive session from an initial prompt
- `--continue`: continue the most recent conversation
- `--conversation <id>`: resume a specific prior conversation

For the `delegate-antigravity` skill, prefer `--print` because it is the most predictable one-shot mode for subagent execution.

## Workspace and Safety Controls

Important flags for delegated work:

- `--add-dir`: add one or more directories to the workspace scope
- `--sandbox`: run with terminal restrictions enabled
- `--dangerously-skip-permissions`: auto-approve permissions without prompting
- `--log-file`: override the CLI log file path
- `--print-timeout`: cap how long `--print` waits for completion

Default guidance for this skill:

- prefer `--add-dir` to constrain workspace scope
- prefer a task-local `--log-file`
- do not use `--dangerously-skip-permissions` unless the user explicitly asks
- use `--sandbox` only when it does not break the required task

## Setup and Configuration Surfaces

Available subcommands include:

- `install`
- `update`
- `models`
- `plugin` or `plugins`
- `changelog`
- `help`

These are useful for environment setup and capability discovery, but they are not the normal execution path for delegated implementation tasks.

## What agy Can Do as a Subagent

In practice, `agy` is a good fit for:

- single-shot natural-language task execution
- scoped work in one or more directories
- conversational follow-up when a prior Antigravity session should be resumed
- producing textual summaries, reports, and next-step recommendations

It is a weaker fit for:

- long-running open-ended tasks with no explicit stop condition
- broad write access over a dirty repository without a tightly scoped plan
- implicit approval of risky actions

## Skill-Specific Guidance

When `delegate_antigravity.py` detects `agy`, it should treat it as a one-shot subagent runner:

- pass a narrow task prompt with `--print`
- scope the workspace with `--add-dir`
- store logs in the task directory with `--log-file`
- require a final execution report in `result.md`
- keep the current planner responsible for review, validation, and acceptance
