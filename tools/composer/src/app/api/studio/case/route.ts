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
  const executionId = searchParams.get('executionId');

  if (!runId || !groupId || !caseId) {
    return NextResponse.json(
      {error: 'runId, groupId, and caseId are required'},
      {status: 400},
    );
  }

  const safeRegex = /^[a-zA-Z0-9_.-]+$/;
  if (!safeRegex.test(runId) || !safeRegex.test(groupId) || !safeRegex.test(caseId) || (executionId && !safeRegex.test(executionId))) {
    return NextResponse.json(
      {error: 'Invalid runId, groupId, caseId, or executionId format'},
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

  let targetCaseDir = caseDir;
  if (executionId) {
    targetCaseDir = path.resolve(STUDIO_ROOT, 'runs', runId, 'executions', executionId, 'groups', groupId, 'cases', caseId);
    const relativeTarget = path.relative(STUDIO_ROOT, targetCaseDir);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      return NextResponse.json(
        {error: 'Access denied: path traversal detected'},
        {status: 403},
      );
    }
  }

  const caseRecord = await readJson(path.join(caseDir, 'case.json'), {});

  async function readWithFallback<T>(fileName: string, fallback: T): Promise<T> {
    if (executionId) {
      const targetPath = path.join(targetCaseDir, fileName);
      try {
        await fs.access(targetPath);
        return await readJson(targetPath, fallback);
      } catch {}
    }
    return await readJson(path.join(caseDir, fileName), fallback);
  }

  const status = await readWithFallback('status.json', {
    runId,
    groupId,
    caseId,
    status: 'queued',
  });
  const result = await readWithFallback('result.json', null);
  const manifest = await readWithFallback(path.join('artifacts', 'manifest.json'), {artifacts: {}});
  const protocol = await readWithFallback('protocol.json', null);
  const catalog = await readWithFallback('catalog.json', null);
  const timeline = await readWithFallback(path.join('artifacts', 'timeline.json'), {events: []});

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
