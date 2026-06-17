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
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const STUDIO_ROOT = path.resolve(process.cwd(), '../../.genui-eval-studio');
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');

const safeRegex = /^[a-zA-Z0-9_.-]+$/;

export async function DELETE(
  _request: NextRequest,
  {params}: {params: Promise<{runId: string}>}
) {
  try {
    const resolvedParams = await params;
    const {runId} = resolvedParams;

    if (!runId) {
      return NextResponse.json({error: 'runId is required'}, {status: 400});
    }

    if (!safeRegex.test(runId)) {
      return NextResponse.json({error: 'Invalid runId'}, {status: 400});
    }

    const runDir = path.join(STUDIO_ROOT, 'runs', runId);

    // Check if directory exists
    try {
      await fs.access(runDir);
    } catch {
      return NextResponse.json({error: 'Run not found'}, {status: 404});
    }

    // Recursively delete directory
    await fs.rm(runDir, {recursive: true, force: true});

    // Rebuild index
    try {
      await execFileAsync(
        'uv',
        [
          'run',
          'python',
          '-c',
          `from genui_eval.studio_storage import StudioStorage; import pathlib; storage = StudioStorage(pathlib.Path('${STUDIO_ROOT.replace(/\\/g, '\\\\')}')); storage.rebuild_indexes()`,
        ],
        {
          cwd: EVAL_ROOT,
          env: {
            ...process.env,
            PYTHONPATH: '.',
          },
        }
      );
    } catch (err) {
      console.error('Failed to rebuild indexes in runs DELETE API:', err);
    }

    return NextResponse.json({success: true});
  } catch (err: any) {
    console.error('[Runs DELETE] error:', err);
    return NextResponse.json({error: err.message || 'Internal server error'}, {status: 500});
  }
}
