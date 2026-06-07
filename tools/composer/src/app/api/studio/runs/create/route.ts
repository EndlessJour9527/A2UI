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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string | null;
    const model = formData.get('model') as string | null;
    const gradingModel = formData.get('gradingModel') as string | null;
    const catalogProfileId = formData.get('catalogProfileId') as string | null;
    const executionMode = formData.get('executionMode') as string | null;

    if (!file || !model) {
      return NextResponse.json(
        {error: 'File and model are required fields'},
        {status: 400},
      );
    }

    if (executionMode && executionMode !== 'serial' && executionMode !== 'parallel') {
      return NextResponse.json({error: 'Invalid executionMode'}, {status: 400});
    }

    if (catalogProfileId && !/^[a-zA-Z0-9_-]+$/.test(catalogProfileId)) {
      return NextResponse.json({error: 'Invalid catalogProfileId'}, {status: 400});
    }

    if (!/^[a-zA-Z0-9_./-]+$/.test(model)) {
      return NextResponse.json({error: 'Invalid model format'}, {status: 400});
    }

    if (gradingModel && !/^[a-zA-Z0-9_./-]+$/.test(gradingModel)) {
      return NextResponse.json({error: 'Invalid gradingModel format'}, {status: 400});
    }

    // Convert file to buffer and save to a temporary workspace location
    const buffer = Buffer.from(await file.arrayBuffer());
    const tempDir = path.join(STUDIO_ROOT, 'tmp');
    await fs.mkdir(tempDir, {recursive: true});
    const tempFilePath = path.join(tempDir, `upload-${Date.now()}-${file.name}`);
    await fs.writeFile(tempFilePath, buffer);

    // Call Python script via subprocess
    const pythonArgs = [
      'bin/create_run_from_excel.py',
      '--file',
      tempFilePath,
      '--model',
      model,
    ];
    if (name) pythonArgs.push('--name', name);
    if (gradingModel) pythonArgs.push('--grading-model', gradingModel);
    if (catalogProfileId) pythonArgs.push('--catalog-profile-id', catalogProfileId);
    if (executionMode) pythonArgs.push('--execution-mode', executionMode);

    try {
      // Execute python script using uv runner
      const {stdout} = await execFileAsync('uv', ['run', 'python', ...pythonArgs], {
        cwd: EVAL_ROOT,
        env: {
          ...process.env,
          PYTHONPATH: '.',
        },
      });

      // Delete temporary uploaded file
      await fs.unlink(tempFilePath).catch(() => {});

      const result = JSON.parse(stdout);
      return NextResponse.json(result);
    } catch (execErr: any) {
      // Clean up temp file in case of error
      await fs.unlink(tempFilePath).catch(() => {});
      console.error('[Runs Create] python script error:', execErr.stderr || execErr.message);
      return NextResponse.json(
        {error: execErr.stderr || execErr.message || 'Failed to parse Excel or initialize run'},
        {status: 500},
      );
    }
  } catch (err: any) {
    console.error('[Runs Create] API error:', err);
    return NextResponse.json(
      {error: err.message || 'Internal server error'},
      {status: 500},
    );
  }
}
