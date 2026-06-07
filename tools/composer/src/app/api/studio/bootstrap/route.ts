import {NextResponse} from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

const STUDIO_ROOT = path.resolve(process.cwd(), '../../.a2ui-eval-studio');

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function GET() {
  const runs = await readJson(path.join(STUDIO_ROOT, 'indexes', 'runs.json'), []);
  const groups = await readJson(path.join(STUDIO_ROOT, 'indexes', 'groups.json'), []);
  const cases = await readJson(path.join(STUDIO_ROOT, 'indexes', 'cases.json'), []);

  return NextResponse.json({
    studioRoot: STUDIO_ROOT,
    runs,
    groups,
    cases,
  });
}
