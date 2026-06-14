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
import {randomUUID} from 'node:crypto';

const execFileAsync = promisify(execFile);
const STUDIO_ROOT = path.resolve(process.cwd(), '../../.genui-eval-studio');
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');
const RUNNING_STATUSES = new Set([
  'preparing',
  'running_protocol',
  'running_render',
  'collecting_device',
]);

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function isPidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLegacyPid(runDir: string): Promise<number | null> {
  try {
    const pid = parseInt((await fs.readFile(path.join(runDir, 'pid.txt'), 'utf8')).trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

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

    const summaryPath = path.join(runDir, 'summary.json');
    const executionPath = path.join(runDir, 'execution.json');
    const currentSummary = await readJson<any>(summaryPath, null);
    const executionMeta = await readJson<any>(executionPath, null);
    const latestExecutionId = currentSummary?.metadata?.latest_execution_id;
    const executionMatchesLatest = !latestExecutionId || !executionMeta?.executionId || executionMeta.executionId === latestExecutionId;
    const activePid = executionMeta?.pid ?? await readLegacyPid(runDir);

    if (currentSummary && RUNNING_STATUSES.has(currentSummary.status) && executionMatchesLatest) {
      if (isPidAlive(activePid)) {
        return NextResponse.json(
          {
            error: 'Run execution is already in progress',
            runId: safeRunId,
            executionId: executionMeta?.executionId ?? latestExecutionId ?? null,
            provider: executionMeta?.provider ?? currentSummary.metadata?.completion_provider ?? null,
            status: currentSummary.status,
          },
          {status: 409},
        );
      }

      currentSummary.status = 'error_infrastructure';
      currentSummary.latest_error = 'Previous execution process is no longer running.';
      currentSummary.metadata = {
        ...(currentSummary.metadata ?? {}),
        stale_execution_id: executionMeta?.executionId ?? latestExecutionId ?? null,
      };
      await fs.writeFile(summaryPath, JSON.stringify(currentSummary, null, 2));
    }

    const executionId = `exec-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

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
        '--validate-only',
        '--provider',
        provider,
        '--execution-id',
        executionId,
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
    try {
      const summaryData = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
      summaryData.status = 'preparing';
      summaryData.metadata = {
        ...(summaryData.metadata ?? {}),
        latest_execution_id: executionId,
        completion_provider: provider,
      };
      await fs.writeFile(summaryPath, JSON.stringify(summaryData, null, 2));
    } catch (err) {
      console.warn('Could not update status to preparing:', err);
    }

    // Create executions/<executionId> folder
    const executionDir = path.join(runDir, 'executions', executionId);
    try {
      await fs.mkdir(executionDir, {recursive: true});
    } catch (err) {
      console.warn('[Runs Execute] Could not create execution directory:', err);
    }

    // Open execution.log in the execution directory for stdout/stderr redirection
    let logFile: any = null;
    let logFd: any = 'ignore';
    try {
      const logPath = path.join(executionDir, 'execution.log');
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
      provider,
      '--execution-id',
      executionId,
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
        
        const payload = {
          executionId,
          pid: child.pid,
          provider,
          startedAt: new Date().toISOString(),
        };

        // Write execution.json to the versioned folder
        const versionedExecutionPath = path.join(executionDir, 'execution.json');
        await fs.writeFile(versionedExecutionPath, JSON.stringify(payload, null, 2));

        // Write execution.json to the run root for compatibility
        await fs.writeFile(executionPath, JSON.stringify(payload, null, 2));
      } catch (pidErr) {
        console.warn('[Runs Execute] Could not write execution metadata:', pidErr);
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

    child.on('close', async (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[Runs Execute] Runner process exited with code ${code}`);
        try {
          const errMsg = `\n[Composer] Runner process exited with code ${code}\n`;
          await fs.appendFile(path.join(executionDir, 'execution.log'), errMsg);
        } catch {}
      }
    });

    child.unref();

    if (logFile) {
      await logFile.close().catch(() => {});
    }

    return NextResponse.json({status: 'started', runId: safeRunId, executionId});
  } catch (err: any) {
    console.error('[Runs Execute] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
