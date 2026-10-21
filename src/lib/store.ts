import { promises as fs } from 'fs';
import path from 'path';

/** Small JSON key-value store. Upstash Redis (REST) when configured, otherwise a local file.
 *  A file does not survive on serverless hosts, so on Vercel an Upstash database is required. */
export type Store = { kind: 'upstash' | 'file'; get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void> };

function upstash(url: string, token: string): Store {
  const cmd = async (body: unknown[]) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: 'no-store' });
    if (!r.ok) throw new Error(`Upstash HTTP ${r.status}`);
    return (await r.json()) as { result?: unknown; error?: string };
  };
  return {
    kind: 'upstash',
    async get<T>(key: string) {
      const j = await cmd(['GET', key]);
      return typeof j.result === 'string' ? (JSON.parse(j.result) as T) : null;
    },
    async set(key, value) {
      const j = await cmd(['SET', key, JSON.stringify(value)]);
      if (j.error) throw new Error(j.error);
    },
  };
}

function file(dir: string): Store {
  const p = (k: string) => path.join(dir, `${k.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  return {
    kind: 'file',
    async get<T>(key: string) {
      try { return JSON.parse(await fs.readFile(p(key), 'utf8')) as T; } catch { return null; }
    },
    async set(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(p(key), JSON.stringify(value, null, 1));
    },
  };
}

export function getStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return upstash(url, token);
  if (process.env.VERCEL) throw new Error('Alert state needs storage on Vercel: add an Upstash Redis database (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).');
  return file(process.env.DATA_DIR || path.join(process.cwd(), '.data'));
}
