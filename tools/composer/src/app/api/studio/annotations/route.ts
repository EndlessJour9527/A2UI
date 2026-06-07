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
const STUDIO_ROOT = path.resolve(process.cwd(), '../../.a2ui-eval-studio');
const EVAL_ROOT = path.resolve(process.cwd(), '../../eval');

const safeRegex = /^[a-zA-Z0-9_.-]+$/;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const runId = searchParams.get('runId');
    const groupId = searchParams.get('groupId');
    const caseId = searchParams.get('caseId');

    if (!runId || !groupId || !caseId) {
      return NextResponse.json({error: 'runId, groupId, and caseId are required'}, {status: 400});
    }

    if (!safeRegex.test(runId) || !safeRegex.test(groupId) || !safeRegex.test(caseId)) {
      return NextResponse.json({error: 'Invalid parameter formats'}, {status: 400});
    }

    const annotationsPath = path.join(
      STUDIO_ROOT,
      'runs',
      runId,
      'groups',
      groupId,
      'cases',
      caseId,
      'annotations.json'
    );

    try {
      const data = await fs.readFile(annotationsPath, 'utf8');
      return NextResponse.json(JSON.parse(data));
    } catch {
      return NextResponse.json({labels: [], notes: []});
    }
  } catch (err: any) {
    return NextResponse.json({error: err.message || 'Internal server error'}, {status: 500});
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {runId, groupId, caseId, type, value, author = 'manual'} = body;

    if (!runId || !groupId || !caseId || !type || !value) {
      return NextResponse.json({error: 'runId, groupId, caseId, type, and value are required'}, {status: 400});
    }

    if (!safeRegex.test(runId) || !safeRegex.test(groupId) || !safeRegex.test(caseId)) {
      return NextResponse.json({error: 'Invalid parameter formats'}, {status: 400});
    }

    const caseDir = path.join(STUDIO_ROOT, 'runs', runId, 'groups', groupId, 'cases', caseId);
    const annotationsPath = path.join(caseDir, 'annotations.json');

    // Ensure case directory exists
    await fs.mkdir(caseDir, {recursive: true});

    let current: any = {labels: [], notes: []};
    try {
      const raw = await fs.readFile(annotationsPath, 'utf8');
      current = JSON.parse(raw);
    } catch {
      // Use empty fallback
    }

    const annotation = {
      annotation_id: `ann-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
      author,
      type,
      value,
      confidence: 1.0,
      source: 'manual',
      metadata: {},
    };

    if (type === 'label') {
      const existingLabels = current.labels || [];
      // Replace existing label by same author to prevent duplication of status labels
      current.labels = existingLabels.filter((l: any) => l.author !== author);
      current.labels.push(annotation);
    } else if (type === 'note') {
      current.notes = current.notes || [];
      current.notes.push(annotation);
    } else {
      current[type] = current[type] || [];
      current[type].push(annotation);
    }

    // Write atomic
    const tmpPath = `${annotationsPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(current, null, 2), 'utf8');
    await fs.rename(tmpPath, annotationsPath);

    // Trigger Python rebuild indexes
    try {
      await execFileAsync(
        'uv',
        [
          'run',
          'python',
          '-c',
          `from a2ui_eval.studio_storage import StudioStorage; import pathlib; storage = StudioStorage(pathlib.Path('${STUDIO_ROOT.replace(/\\/g, '\\\\')}')); storage.rebuild_indexes()`,
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
      console.error('Failed to rebuild indexes in annotations API:', err);
    }

    return NextResponse.json({success: true, annotations: current});
  } catch (err: any) {
    console.error('[Annotations POST] error:', err);
    return NextResponse.json({error: err.message || 'Internal server error'}, {status: 500});
  }
}
