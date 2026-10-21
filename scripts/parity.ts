/* Checks that the TypeScript engine gives the same labels as the Python engine (crypto_alerts.py)
 * on the same candles.  Usage: tsx scripts/parity.ts <dir with SYM.json compact rows> <as-of ISO> */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { strongCheck } from '../src/lib/alerts';
import type { Bar } from '../src/lib/types';

const dir = process.argv[2], asOf = Date.parse(process.argv[3] || new Date().toISOString());
const out: Record<string, { label: string; score: number; close: number }> = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'alerts.json')) {
  const sym = f.slice(0, -5).toUpperCase();
  let j: unknown; try { j = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!Array.isArray(j) || !Array.isArray(j[0])) continue;
  const bars: Bar[] = (j as [string, number, number, number, number, number][]).map(r => ({ t: Date.parse(r[0]), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t);
  const s = strongCheck(sym, bars, asOf);
  if (s) out[sym] = { label: s.label, score: s.score, close: s.close };
}
console.log(JSON.stringify(out));
