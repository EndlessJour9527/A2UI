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

const STUDIO_ROOT = path.resolve(process.cwd(), '../../.a2ui-eval-studio');

const RUNNING_STATUSES = new Set([
  'queued',
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
    } catch (err) {
      // It is fine if events.jsonl does not exist yet or is empty
    }

    const isRunning = RUNNING_STATUSES.has(summary.status);

    return NextResponse.json({
      summary,
      recentEvents,
      isRunning,
    });
  } catch (err: any) {
    console.error('[Runs Status] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
