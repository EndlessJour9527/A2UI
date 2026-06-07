/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {NextRequest, NextResponse} from 'next/server';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const STUDIO_ROOT = path.resolve(process.cwd(), '../../.a2ui-eval-studio');
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {runId, provider = 'mock'} = body;

    if (!runId || typeof runId !== 'string' || !/^run-[a-zA-Z0-9-]+$/.test(runId)) {
      return NextResponse.json({error: 'Invalid or missing runId'}, {status: 400});
    }

    if (typeof provider !== 'string' || !/^(mock|static|llm:[a-zA-Z0-9-./_]+)$/.test(provider)) {
      return NextResponse.json({error: 'Invalid provider format'}, {status: 400});
    }

    // Sanitize and check run exists
    const safeRunId = path.basename(runId);
    const runDir = path.join(STUDIO_ROOT, 'runs', safeRunId);
    try {
      await fs.access(runDir);
    } catch {
      return NextResponse.json({error: 'Run not found'}, {status: 404});
    }

    // Update status to preparing in summary.json before spawning
    const summaryPath = path.join(runDir, 'summary.json');
    try {
      const summaryData = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
      summaryData.status = 'preparing';
      await fs.writeFile(summaryPath, JSON.stringify(summaryData, null, 2));
    } catch (err) {
      console.warn('Could not update status to preparing:', err);
    }

    // Spawn Python orchestrator run_executor.py
    const child = spawn('uv', [
      'run',
      'python',
      '-m',
      'a2ui_eval.run_executor',
      safeRunId,
      '--provider',
      provider
    ], {
      cwd: EVAL_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: '.',
      },
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    return NextResponse.json({status: 'started', runId: safeRunId});
  } catch (err: any) {
    console.error('[Runs Execute] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
