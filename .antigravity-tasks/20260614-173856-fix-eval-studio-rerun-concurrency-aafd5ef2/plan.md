# Fix Eval Studio Rerun Concurrency

## Goal

Prevent intermittent Eval Studio rerun failures and state corruption when a completed run is rerun after switching models, especially when the user clicks Run again while an execution for the same run is already active.

## Scope

You may modify only:

- `eval/genui_eval/run_executor.py`
- `eval/genui_eval/studio_storage.py`
- `eval/genui_eval/studio_orchestrator.py`
- `eval/tests/test_run_executor.py`
- `eval/tests/test_studio.py`
- `tools/composer/src/app/api/studio/runs/execute/route.ts`
- `tools/composer/src/app/api/studio/runs/[runId]/status/route.ts`
- `tools/composer/src/app/studio/run/[runId]/page.tsx`
- `tools/composer/src/lib/studio-run-events.ts`
- `tools/composer/src/lib/studio-run-events.test.ts`
- focused new tests only if needed under the same areas

## Out of Scope

- Do not modify provider credentials, `.env` files, remote state, or API keys.
- Do not change unrelated packages, lockfiles, renderer packages, visual parity packages, or docs.
- Do not commit, push, create branches, reset, clean, force checkout, or revert unrelated user changes.
- Do not try to eliminate real upstream NVIDIA `503 Service Unavailable`; tolerate and report it accurately.

## Constraints

- Preserve existing provider support:
  - `nvidia:z-ai/glm-5.1`
  - `nvidia:nvidia/llama-3.1-nemotron-70b-instruct`
  - `nvidia:deepseek-ai/deepseek-v4-flash`
  - existing mock/static/local-openai/llm flows
- Existing `--validate-only` behavior must remain non-mutating.
- Preserve backward compatibility with existing run artifacts that only have `pid.txt` or old `run.created` events.
- Keep changes focused and consistent with existing TypeScript/Python style.

## Current Evidence

`run-b8f609171d51` shows:

- First execution: `nvidia:nvidia/llama-3.1-nemotron-70b-instruct`
- Rerun after model switch: `nvidia:z-ai/glm-5.1`
- Latest rerun completed successfully, but `execution.log` shows one transient NVIDIA `503 Service Unavailable` followed by SDK retry success.
- The current execute API can spawn another background process for the same run without checking active execution state.
- Concurrent executions share the same `pid.txt`, `execution.log`, case statuses, `run.json`, and `summary.json`, which can cause intermittent failure and stale state overwrites.

## Required Implementation

1. Add a per-execution id:
   - Composer execute API generates a unique `executionId` for every accepted execution start.
   - Pass it to `genui_eval.run_executor` using `--execution-id`.
   - Add a CLI argument in `run_executor.py`, defaulting to a generated id for direct CLI/backward-compatible usage.
   - Persist `execution_id` / `executionId` in run metadata, summary metadata, and the `run.execution_started` event payload.

2. Add execution metadata:
   - Write `runs/<run-id>/execution.json` containing at least:
     - `executionId`
     - `pid`
     - `provider`
     - `startedAt`
   - Keep `pid.txt` for compatibility, but new logic should prefer `execution.json`.

3. Prevent same-run concurrent execution:
   - Before spawning in the execute route, read summary and execution metadata.
   - If the run status is active and the latest recorded pid is alive for the latest execution id, return HTTP `409` JSON with:
     - `error`
     - `runId`
     - `executionId`
     - `provider`
     - `status`
   - If status is active but pid is stale, record a clear stale-process condition before accepting a new execution. Do not let a stale process overwrite a newer execution.

4. Make status API execution-aware:
   - Use latest `run.execution_started` as the event boundary, including `executionId`.
   - Trust pid checks only for the latest execution id.
   - If a pid has exited, mark infrastructure error only if the latest summary is still active and belongs to that same latest execution id.
   - Never overwrite a newer completed/running execution with an older stale pid result.

5. Improve UI rerun behavior:
   - If execute returns `409`, keep the selected provider/model visible and show a friendly “already running” message instead of treating it like an ordinary failed start.
   - Keep current provider/model locked during active execution refreshes until the latest execution leaves an active status.

## Validation

Run when practical:

```bash
cd eval
uv run pytest tests/test_run_executor.py tests/test_studio.py
```

```bash
cd tools/composer
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/vitest run src/lib/studio-run-events.test.ts
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

```bash
git diff --check
```

## Required Completion Evidence

Report:

- Summary of changes.
- Files changed.
- Validation commands run and pass/fail.
- Any skipped validation and why.
- Remaining risks or follow-ups.
- Explicitly note if the work was blocked.
