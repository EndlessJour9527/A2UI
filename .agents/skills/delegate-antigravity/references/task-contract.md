# Antigravity Task Contract

Use this contract when preparing a task for local Antigravity execution.

## Required Task Package

Include these sections in the delegated plan:

- Goal: one concise statement of the implementation outcome.
- Scope: files, directories, or subsystems Antigravity may change.
- Out of scope: changes Antigravity must avoid.
- Constraints: coding style, repository rules, safety limits, and user preferences.
- Steps: ordered implementation instructions with no unresolved decisions.
- Validation: commands Antigravity should run and expected results.
- Completion evidence: what Antigravity must report back.

## Execution Rules

Antigravity may edit files only inside the allowed scope. It must preserve unrelated working tree changes and must not run destructive commands such as reset, clean, force checkout, or mass deletion unless the task explicitly grants permission.

Antigravity must not commit, push, create pull requests, or modify remote state unless the task explicitly grants permission.

If the plan is ambiguous or unsafe, Antigravity should stop and report `blocked` rather than guessing.

## Required Result Report

Ask Antigravity to write or print:

- Summary of changes made.
- Files changed.
- Commands run and pass/fail status.
- Any skipped validation and why.
- Risks, assumptions, or follow-up needed.
- Blocking condition if it could not complete the task.

The planner must independently verify the result before presenting it as done.
