---
name: run-genui-studio
description: Run and verify this repository's GenUI Eval Studio workflow. Use when Codex is asked to start GenUI Eval Studio, seed or execute Eval Studio runs, inspect .genui-eval-studio artifacts, validate A2UI/OpenUI protocol-pack behavior, or delegate cheap subagents to run Studio/eval verification tasks.
---

# Run GenUI Studio

## Purpose

Use this skill to run the local GenUI Eval Studio stack in this repository and collect verification evidence for generated UI eval runs. Prefer delegating long-running execution, log watching, or artifact inspection to a cheap `gpt-5.4-mini` subagent when the user asks to create subagents or when execution can proceed independently from your current edits.

## Repo Paths

- Eval backend: `eval/`
- Composer Studio UI: `tools/composer/`
- Studio storage root: `.genui-eval-studio/`
- Python package: `genui_eval`
- Run executor module: `genui_eval.run_executor`
- Protocol packs: `eval/genui_eval/protocols/`

Do not use the legacy `a2ui_eval` package name or `.a2ui-eval-studio` storage root.

## Subagent Strategy

When subagents are available and the user has asked for subagent use, spawn a bounded worker with `model: "gpt-5.4-mini"` for cheap execution work. Keep the main agent responsible for decisions, code edits, and final synthesis.

Good subagent tasks:

- start or monitor Composer dev server logs
- run `uv sync` and `uv run pytest` from `eval/`
- run `npm test` or `npm run build` from `tools/composer/`
- execute a seeded Studio run with mock/static provider
- execute a seeded Studio run through the local OpenAI-compatible proxy
- inspect `.genui-eval-studio/runs/<run-id>/...` artifacts and summarize status

Example delegation prompt:

```text
Use the project skill at .codex/skills/run-genui-studio to run GenUI Eval Studio verification.
Work in /Users/next/develop/ai-proj/A2UI. Do not revert others' changes.
Own only runtime verification: run eval tests, run Composer tests/build if practical, and inspect .genui-eval-studio artifacts.
Report commands run, pass/fail status, URLs, and relevant artifact paths. Do not edit files.
```

If spawning a subagent would require approvals, network access, or a long-lived server beyond the current task, ask the user before delegating.

## Standard Workflow

1. Inspect current state:

```bash
git status --short
rg -n "genui_eval|\\.genui-eval-studio|python -m a2ui" eval tools/composer/src docs/specification/eval-studio-v0.1.md
```

2. Verify backend:

```bash
cd eval
uv sync
uv run pytest
```

For a faster Studio-only check, use:

```bash
cd eval
PYTHONPATH=. uv run pytest tests/test_studio.py
```

If `uv` fails because the sandbox cannot read `~/.cache/uv`, rerun the same command with approval/escalation.

3. Seed a sample run when no run exists:

```bash
cd eval
uv run python bin/create_studio_run.py
```

After seeding, confirm the UI has source data:

```bash
test -f ../.genui-eval-studio/indexes/runs.json
test -f ../.genui-eval-studio/indexes/cases.json
find ../.genui-eval-studio/runs -maxdepth 2 -name summary.json
```

For Excel-driven test sets:

```bash
cd eval
uv run python bin/create_run_from_excel.py --file <path-to-xlsx> --model <model-name>
```

4. Execute a run without external LLM cost:

```bash
cd eval
uv run python -m genui_eval.run_executor <run-id> --provider mock
```

Use `mock` for smoke tests because it avoids external services and should produce valid protocol artifacts. Use `static` when cases include target payloads and the goal is to replay/evaluate those exact targets. Use `local-openai:<model>` when the user's local OpenAI-compatible proxy is running. Use `llm:<model>` only when the user explicitly wants real model calls and credentials are available.

For the local proxy, configure credentials through environment variables. Do not write API keys into committed files:

```bash
export GENUI_EVAL_LOCAL_OPENAI_BASE_URL="http://127.0.0.1:8045/v1"
export GENUI_EVAL_LOCAL_OPENAI_API_KEY="<local-proxy-api-key>"
export GENUI_EVAL_LOCAL_OPENAI_MODEL="gemini-3.5-flash-extra-low"
cd eval
uv run python -m genui_eval.run_executor <run-id> --provider local-openai:gemini-3.5-flash-extra-low
```

The equivalent Python client shape is OpenAI-compatible:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8045/v1",
    api_key="<local-proxy-api-key>",
)

response = client.chat.completions.create(
    model="gemini-3.5-flash-extra-low",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

5. Start Composer Studio:

```bash
cd tools/composer
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run dev
```

On macOS arm64, prefer Webpack over Turbopack to avoid Next/SWC signing issues:

```bash
cd tools/composer
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npx next dev --webpack --port 3001
```

Default URL is `http://localhost:3001/studio`.

If port 3001 is occupied, find the next free port and pass it explicitly:

```bash
lsof -iTCP:3001 -sTCP:LISTEN
cd tools/composer
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npx next dev --webpack --port 3002
```

Report the final URL, including the port.

6. Verify frontend:

```bash
cd tools/composer
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
PATH=/Users/next/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
```

If `npm run build` fails only because Next cannot fetch Google Fonts in the sandbox, rerun with approval/escalation. If local `node` fails on `node:util.styleText`, use the bundled Node path above.

## Artifact Checks

For each completed case, inspect:

- `raw/raw_completion.md`
- `protocol/parsed.json`
- `protocol/normalized.json`
- `protocol/validation.json`
- `protocol/semantic_eval.json`
- `protocol.json`
- `artifacts/manifest.json`
- `render/replay.json` for A2UI cases

Expected protocol indicators:

- A2UI cases: `protocolId` or `protocol_id` is `a2ui`, catalog profile may be present.
- OpenUI skeleton cases: `protocolId` or `protocol_id` is `openui`, validation may pass with a skeleton warning, replay/render may be JSON evidence rather than visual preview.

## Reporting

Report only high-signal facts:

- Studio URL
- run id and provider used
- tests/build commands and outcomes
- failed case counts and latest errors
- important artifact paths
- whether subagent execution was used and which model handled it
