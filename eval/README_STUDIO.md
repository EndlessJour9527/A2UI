# A2UI Eval Studio Running Guide

This guide describes how to run evaluations, seed local run data, and launch the **A2UI Eval Studio** control plane and review workspace.

---

## 1. Directory Structure

- **Backend / Storage Layer**: Located in `eval/`. Built using Python + Inspect AI.
- **Frontend / Review Workspace**: Located in `tools/composer/`. Built using Next.js.
- **Shared Storage**: Created dynamically in the repository root as `.a2ui-eval-studio/` to share runs, indices, and catalog configs between backend and frontend.

---

## 2. Backend Setup & Run Seeding

First, seed a local sample evaluation run to verify the filesystem storage and generate data for the frontend to display.

### Prerequisites
Make sure you have `uv` installed. If not, follow instructions at [astral.sh/uv](https://astral.sh/uv).

### Step 1: Install Python dependencies
Navigate to the `eval/` directory and sync dependencies:
```bash
cd eval
uv sync
```

### Step 2: Seed a Sample Studio Run
Run the bootstrap script to create a run definition, initialize catalog profiles, parse/validate sample completions, and rebuild indices:
```bash
uv run python bin/create_studio_run.py --name "A2UI Studio MVP Seed Run"
```

This will output a JSON payload indicating success and showing the workspace paths:
```json
{
  "studioRoot": "/Users/next/develop/ai-proj/A2UI/.a2ui-eval-studio",
  "runId": "run-d9c479b3f8ec",
  "runPath": "/Users/next/develop/ai-proj/A2UI/.a2ui-eval-studio/runs/run-d9c479b3f8ec",
  "summaryPath": "/Users/next/develop/ai-proj/A2UI/.a2ui-eval-studio/runs/run-d9c479b3f8ec/summary.json",
  "indexesPath": "/Users/next/develop/ai-proj/A2UI/.a2ui-eval-studio/indexes/runs.json"
}
```

### Step 3: Run Backend Tests (Optional)
To verify everything is working fine, run backend studio unit tests:
```bash
PYTHONPATH=. uv run pytest tests/test_studio.py
```

---

## 3. Frontend Setup & Startup

The frontend loads the indexes and runs directly from `.a2ui-eval-studio/` and exposes a WebUI.

### Step 1: Install Node.js dependencies
Navigate to the `tools/composer/` directory and install packages:
```bash
cd ../tools/composer
npm install
```

### Step 2: Start the Web App Server
Start the local development server. 

> [!IMPORTANT]
> **MacOS arm64 Users**: Next.js 15/16 uses native SWC bindings that can trigger code signing/Team ID validation blocks on macOS.
> You **must** run the development server with Webpack instead of Turbopack by appending the `--webpack` flag:
> ```bash
> PATH="/Users/next/.nvm/versions/node/v22.22.0/bin:$PATH" npx next dev --webpack --port 3001
> ```

The dev server will boot up:
```text
▲ Next.js 16.2.6 (Webpack)
- Local:         http://localhost:3001
- Network:       http://192.168.31.216:3001
✓ Ready in 1.2s
```

---

## 4. Accessing the UI

1. Open your web browser and navigate to `http://localhost:3001`.
2. Look at the left sidebar navigation menu and click **Studio** (marked with a chemistry flask icon `FlaskConical`).
3. You will land on the **Runs overview** page (`http://localhost:3001/studio`) showing recent runs, group statistics, and status metrics.
4. Click **Open** to drill down into a run, open groups, and select any case (e.g., `hello-world`) to inspect the visual replay preview, protocol validation results, and active catalog profiles.
