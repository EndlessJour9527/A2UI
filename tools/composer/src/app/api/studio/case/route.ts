import {NextRequest, NextResponse} from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const STUDIO_ROOT = path.resolve(process.cwd(), '../../.genui-eval-studio');

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runId = searchParams.get('runId');
  const groupId = searchParams.get('groupId');
  const caseId = searchParams.get('caseId');

  if (!runId || !groupId || !caseId) {
    return NextResponse.json(
      {error: 'runId, groupId, and caseId are required'},
      {status: 400},
    );
  }

  const safeRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!safeRegex.test(runId) || !safeRegex.test(groupId) || !safeRegex.test(caseId)) {
    return NextResponse.json(
      {error: 'Invalid runId, groupId, or caseId format'},
      {status: 400},
    );
  }

  const caseDir = path.resolve(STUDIO_ROOT, 'runs', runId, 'groups', groupId, 'cases', caseId);
  const relative = path.relative(STUDIO_ROOT, caseDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return NextResponse.json(
      {error: 'Access denied: path traversal detected'},
      {status: 403},
    );
  }

  const caseRecord = await readJson(path.join(caseDir, 'case.json'), {});
  const status = await readJson(path.join(caseDir, 'status.json'), {
    runId,
    groupId,
    caseId,
    status: 'queued',
  });
  const result = await readJson(path.join(caseDir, 'result.json'), null);
  const manifest = await readJson(path.join(caseDir, 'artifacts', 'manifest.json'), {artifacts: {}});
  const protocol = await readJson(path.join(caseDir, 'protocol.json'), null);
  const catalog = await readJson(path.join(caseDir, 'catalog.json'), null);
  const timeline = await readJson(path.join(caseDir, 'artifacts', 'timeline.json'), {events: []});

  return NextResponse.json({
    caseRecord,
    status,
    result,
    manifest,
    protocol,
    catalog,
    timeline,
  });
}
