/* Replays the daily setup detector over past sessions to see what it would have flagged and what happened next.
 * Usage: tsx scripts/replay-setups.ts [days=60] [focus=SWIGGY:2026-10-23]. Prints only; sends nothing. */
import { getBars } from '../src/yahoo.ts';
import { watchList } from '../src/universe.ts';
import { setupCheck } from '../src/setups.ts';
import type { Bar } from '../src/types.ts';

const days = +(process.argv[2] || 60), focus = process.argv[3] || 'SWIGGY:2026-10-23';
const day = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const data: Record<string, Bar[]> = {};
for (const s of ['NIFTY', ...watchList()]) { try { data[s] = await getBars(s, '1d', '2y'); } catch { /* skip */ } }
const nifty = data.NIFTY, dates = nifty.map(b => day(b.t)).slice(-days - 3, -3);
let n = 0, trig = 0, win = 0; const R: number[] = [];
for (const d of dates) {
  const idx = nifty.filter(b => day(b.t) < d);
  for (const s of Object.keys(data)) {
    const all = data[s], cut = all.filter(b => day(b.t) < d), next = all.filter(b => day(b.t) >= d).slice(0, 3);
    if (next.length < 3) continue;
    const x = setupCheck(s, cut, s === 'NIFTY' ? null : idx); if (!x) continue;
    n++;
    const up = x.dir === 'up', hit = next.findIndex(b => up ? b.h > x.level * 1.002 : b.l < x.level * 0.998);
    if (hit < 0) continue;
    trig++;
    const risk = Math.abs(x.level - x.invalid) || x.atr, after = next[2].c, r = (up ? after - x.level : x.level - after) / risk;
    R.push(r); if (r > 0) win++;
  }
}
const avg = R.reduce((a, b) => a + b, 0) / (R.length || 1);
console.log(`Last ${dates.length} sessions: ${n} setups, ${trig} triggered within 3 days, ${win} of those in profit after 3 days, avg ${avg.toFixed(2)}R (stock move vs stop distance, before costs).`);
const [fs, fd] = focus.split(':');
for (const d of [fd, ...[1, 2, 3, 4, 5].map(k => { const i = nifty.findIndex(b => day(b.t) >= fd); return nifty[i - k] ? day(nifty[i - k].t) : fd; })]) {
  const all = data[fs] || [], cut = all.filter(b => day(b.t) < d), today = all.find(b => day(b.t) === d);
  const x = setupCheck(fs, cut, nifty.filter(b => day(b.t) < d));
  console.log(`${fs} before ${d}: ${x ? `${x.dir === 'up' ? 'CALL' : 'PUT'} watch ${x.points}/6 level ${x.level.toFixed(2)} (${x.dist.toFixed(1)}% away): ${x.reasons.join('; ')}` : 'no setup'}` +
    (today ? ` | that day O ${today.o.toFixed(2)} H ${today.h.toFixed(2)} L ${today.l.toFixed(2)} C ${today.c.toFixed(2)}` : ''));
}
