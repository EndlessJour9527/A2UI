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
import fs from 'node:fs/promises';
import path from 'node:path';

const STUDIO_ROOT = path.resolve(process.cwd(), '../../.genui-eval-studio');

const RUNNING_STATUSES = new Set([
  'preparing',
  'running_protocol',
  'running_render',
  'collecting_device',
]);

export async function GET(
  request: NextRequest,
  {params}: {params: Promise<{runId: string}>}
) {
  try {
    const resolvedParams = await params;
    const {runId} = resolvedParams;

    if (!runId) {
      return NextResponse.json({error: 'runId is required'}, {status: 400});
    }

    // Sanitize runId to prevent path traversal
    const safeRegex = /^[a-zA-Z0-9_.-]+$/;
    if (!safeRegex.test(runId)) {
      return NextResponse.json({error: 'Invalid runId format'}, {status: 400});
    }

    const runDir = path.join(STUDIO_ROOT, 'runs', runId);
    
    // Check if run directory exists
    try {
      await fs.access(runDir);
    } catch {
      return NextResponse.json({error: 'Run not found'}, {status: 404});
    }

    // Read summary.json
    const summaryPath = path.join(runDir, 'summary.json');
    let summary: any = null;
    try {
      const summaryRaw = await fs.readFile(summaryPath, 'utf8');
      summary = JSON.parse(summaryRaw);
    } catch (err) {
      return NextResponse.json({error: 'Run summary not found or corrupted'}, {status: 404});
    }

    // Read events.jsonl
    const eventsPath = path.join(runDir, 'events.jsonl');
    const recentEvents: any[] = [];
    let latestExecutionStartIndex = 0;
    try {
      const eventsRaw = await fs.readFile(eventsPath, 'utf8');
      const lines = eventsRaw.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            recentEvents.push(JSON.parse(trimmed));
          } catch {
            // Ignore corrupted lines
          }
        }
      }
      const lastCreatedIndex = recentEvents
        .map((event, index) => ({event, index}))
        .filter(item => item.event.event_type === 'run.created')
        .at(-1)?.index;
      if (lastCreatedIndex !== undefined) {
        latestExecutionStartIndex = lastCreatedIndex;
      }
    } catch (err) {
      // It is fine if events.jsonl does not exist yet or is empty
    }

    let isRunning = RUNNING_STATUSES.has(summary.status);
    if (isRunning) {
      const pidPath = path.join(runDir, 'pid.txt');
      try {
        const pidStr = (await fs.readFile(pidPath, 'utf8')).trim();
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0);
          } catch (killErr: any) {
            if (killErr.code === 'ESRCH') {
              // The process has exited!
              isRunning = false;

              // Read execution.log if present to capture error
              const logPath = path.join(runDir, 'execution.log');
              let logContent = '';
              try {
                logContent = await fs.readFile(logPath, 'utf8');
              } catch {}

              let extractedError = 'The background runner process exited unexpectedly.';
              if (logContent) {
                const lines = logContent.split('\n').map(l => l.trim()).filter(Boolean);
                // Find lines containing common error markers or tracebacks
                const errorLines = lines.filter(l => 
                  l.toLowerCase().includes('error:') || 
                  l.toLowerCase().includes('exception:') || 
                  l.includes('Traceback') || 
                  l.includes('ValueError:')
                );
                if (errorLines.length > 0) {
                  extractedError = errorLines[errorLines.length - 1] || 'The background runner process exited unexpectedly.';
                } else if (lines.length > 0) {
                  extractedError = lines.slice(-3).join('\n');
                }
              }

              // Update summary.json
              summary.status = 'error_infrastructure';
              summary.latest_error = extractedError;
              try {
                await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
              } catch (writeErr) {
                console.warn('Failed to update summary.json after process exit:', writeErr);
              }
            }
          }
        }
      } catch (err) {
        // pid.txt might not exist yet if process is starting up, which is fine
      }
    }

    // Read execution.log if present to capture any stdout/stderr errors (e.g. env issues, launch failures)
    const logPath = path.join(runDir, 'execution.log');
    let executionLog: string | null = null;
    try {
      executionLog = await fs.readFile(logPath, 'utf8');
    } catch {
      // Ignored if file does not exist
    }
    if (!executionLog && recentEvents.length > 0) {
      executionLog = formatEventLog(recentEvents, latestExecutionStartIndex);
    }

    return NextResponse.json({
      summary,
      recentEvents,
      latestExecutionStartIndex,
      isRunning,
      executionLog,
    });
  } catch (err: any) {
    console.error('[Runs Status] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}

function formatEventLog(events: any[], latestExecutionStartIndex: number) {
  const scopedEvents = events.slice(latestExecutionStartIndex);
  return scopedEvents
    .map(event => {
      const timestamp = event.timestamp || '';
      const type = event.event_type || 'event';
      const payload = event.payload || {};
      const parts = [
        payload.groupId ? `group=${payload.groupId}` : '',
        payload.caseId ? `case=${payload.caseId}` : '',
        payload.status ? `status=${payload.status}` : '',
        payload.completionProvider ? `provider=${payload.completionProvider}` : '',
      ].filter(Boolean);
      return `[${timestamp}] ${type}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`;
    })
    .join('\n');
}
