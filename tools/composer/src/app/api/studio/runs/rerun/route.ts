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
import path from 'node:path';

const execFileAsync = promisify(execFile);
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {runId, groupId, name} = body;

    if (!runId || !groupId) {
      return NextResponse.json(
        {error: 'runId and groupId are required'},
        {status: 400},
      );
    }

    const safeRegex = /^[a-zA-Z0-9_.-]+$/;
    if (!safeRegex.test(runId) || !safeRegex.test(groupId)) {
      return NextResponse.json(
        {error: 'Invalid runId or groupId format'},
        {status: 400},
      );
    }

    // Call Python script via subprocess
    const pythonArgs = [
      'bin/create_rerun.py',
      '--run-id',
      runId,
      '--group-id',
      groupId,
    ];
    if (name) {
      pythonArgs.push('--name', name);
    }

    try {
      const {stdout} = await execFileAsync('uv', ['run', '--python', '3.14', 'python', ...pythonArgs], {
        cwd: EVAL_ROOT,
        env: {
          ...process.env,
          PYTHONPATH: '.',
        },
      });

      const result = JSON.parse(stdout);
      return NextResponse.json(result);
    } catch (execErr: any) {
      console.error('[Rerun Create] python script error:', execErr.stderr || execErr.message);
      let errorMsg = execErr.stderr || execErr.message || 'Failed to create rerun';
      try {
        const parsed = JSON.parse(errorMsg.trim());
        if (parsed.error) {
          errorMsg = parsed.error;
        }
      } catch {}
      return NextResponse.json(
        {error: errorMsg},
        {status: 500},
      );
    }
  } catch (err: any) {
    console.error('[Rerun Create] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
