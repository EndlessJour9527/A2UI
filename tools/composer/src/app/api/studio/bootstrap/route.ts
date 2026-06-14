import {NextResponse} from 'next/server';
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

export async function GET() {
  const runs = await readJson(path.join(STUDIO_ROOT, 'indexes', 'runs.json'), []);
  const groups = await readJson(path.join(STUDIO_ROOT, 'indexes', 'groups.json'), []);
  const cases = await readJson(path.join(STUDIO_ROOT, 'indexes', 'cases.json'), []);

  // Parse eval/genui_eval/.env to retrieve local-openai proxy details
  let proxyModel = 'gemini-3.5-flash-extra-low';
  let proxyPort = '8045';
  try {
    const envPath = path.resolve(process.cwd(), '../../eval/genui_eval/.env');
    const envRaw = await fs.readFile(envPath, 'utf-8');
    const lines = envRaw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(["']?)(.*?)\2$/i);
      if (match) {
        const key = match[1];
        const val = match[3] || '';
        if (key === 'GENUI_EVAL_LOCAL_OPENAI_MODEL' && val) {
          proxyModel = val;
        } else if (key === 'GENUI_EVAL_LOCAL_OPENAI_BASE_URL' && val) {
          const portMatch = val.match(/:(\d+)(?:\/|$)/);
          if (portMatch && portMatch[1]) {
            proxyPort = portMatch[1];
          }
        }
      }
    }
  } catch (err) {
    // Ignore if file doesn't exist
  }

  const providers = [
    {
      id: 'mock',
      name: 'Mock',
      models: ['mock']
    },
    {
      id: 'static',
      name: 'Static target',
      models: ['static']
    },
    {
      id: 'llm',
      name: 'Gemini API (Direct)',
      models: [
        'google/gemini-2.5-flash',
        'google/gemini-3.5-flash',
        'google/gemini-3-flash-preview',
        'google/gemini-2.5-pro',
        'google/gemini-1.5-flash',
        'google/gemini-1.5-pro'
      ]
    },
    {
      id: 'local-openai',
      name: 'Local OpenAI Proxy',
      models: [
        `proxy_${proxyPort}_${proxyModel}`
      ]
    },
    {
      id: 'nvidia',
      name: 'Nvidia API',
      models: [
        'deepseek-ai/deepseek-v4-flash',
        'nvidia/llama-3.1-nemotron-70b-instruct',
        'z-ai/glm-5.1'
      ]
    }
  ];

  return NextResponse.json({
    studioRoot: STUDIO_ROOT,
    runs,
    groups,
    cases,
    proxy: {
      model: proxyModel,
      port: proxyPort,
      formatted: `proxy_${proxyPort}_${proxyModel}`,
    },
    providers,
  });
}
