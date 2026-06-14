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
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const STUDIO_ROOT = path.resolve(process.cwd(), '../../.genui-eval-studio');
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {runId, provider = 'mock'} = body;

    if (!runId || typeof runId !== 'string' || !/^run-[a-zA-Z0-9-]+$/.test(runId)) {
      return NextResponse.json({error: 'Invalid or missing runId'}, {status: 400});
    }

    if (typeof provider !== 'string' || !/^(mock|static|[a-zA-Z0-9-]+(?::[a-zA-Z0-9-./_]+)?)$/.test(provider)) {
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

    // Perform pre-execution validation using --validate-only flag
    try {
      await execFileAsync('uv', [
        'run',
        '--python',
        '3.14',
        'python',
        '-m',
        'genui_eval.run_executor',
        safeRunId,
        '--validate-only'
      ], {
        cwd: EVAL_ROOT,
        env: {
          ...process.env,
          PYTHONPATH: '.',
          PYTHONUNBUFFERED: '1',
        },
      });
    } catch (execErr: any) {
      console.warn('[Runs Execute] Pre-execution compatibility validation failed:', execErr.stderr || execErr.message);
      // Attempt to parse structured validation error JSON from stderr
      let errors: string[] = [];
      const stderrStr = (execErr.stderr || '').trim();
      try {
        const lines = stderrStr.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            const parsed = JSON.parse(line.trim());
            if (parsed.errors) {
              errors = parsed.errors;
              break;
            }
          }
        }
      } catch (parseErr) {
        // Ignore parse error
      }

      if (errors.length === 0) {
        errors = [execErr.stderr || execErr.message || 'Run compatibility checks failed. Please check catalog config.'];
      }

      return NextResponse.json(
        {
          error: 'Compatibility validation checks failed',
          details: errors
        },
        {status: 400},
      );
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

    // Open execution.log in the run directory for stdout/stderr redirection
    let logFile: any = null;
    let logFd: any = 'ignore';
    try {
      const logPath = path.join(runDir, 'execution.log');
      logFile = await fs.open(logPath, 'w');
      logFd = logFile.fd;
    } catch (err) {
      console.warn('[Runs Execute] Could not open execution.log for writing:', err);
    }

    // Spawn Python orchestrator run_executor.py
    const child = spawn('uv', [
      'run',
      '--python',
      '3.14',
      'python',
      '-m',
      'genui_eval.run_executor',
      safeRunId,
      '--provider',
      provider
    ], {
      cwd: EVAL_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: '.',
        PYTHONUNBUFFERED: '1',
      },
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });

    if (child.pid) {
      try {
        const pidPath = path.join(runDir, 'pid.txt');
        await fs.writeFile(pidPath, child.pid.toString());
      } catch (pidErr) {
        console.warn('[Runs Execute] Could not write pid.txt:', pidErr);
      }
    }

    child.on('error', async (err) => {
      console.error('[Runs Execute] Failed to start child process:', err);
      try {
        const errorMsg = `Failed to spawn runner process: ${err.message}`;
        await fs.appendFile(path.join(runDir, 'execution.log'), `\n${errorMsg}\n`);
        
        const summaryData = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
        summaryData.status = 'error_infrastructure';
        summaryData.latest_error = errorMsg;
        await fs.writeFile(summaryPath, JSON.stringify(summaryData, null, 2));
      } catch (logErr) {
        console.error('[Runs Execute] Failed to log spawn error:', logErr);
      }
    });

    child.unref();

    if (logFile) {
      await logFile.close().catch(() => {});
    }

    return NextResponse.json({status: 'started', runId: safeRunId});
  } catch (err: any) {
    console.error('[Runs Execute] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
