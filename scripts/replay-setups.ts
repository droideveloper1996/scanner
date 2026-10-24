/* Replays the crypto daily setup detector over past days: what it flagged and what happened in the next 3 days.
 * Usage: tsx scripts/replay-setups.ts [days=120]. KuCoin daily candles; prints only, sends nothing. */
import { kucoinCandles, kucoinTopCoins } from '../src/lib/kucoin';
import { alertCoins } from '../src/lib/config';
import { setupCheck } from '../src/lib/setups';
import type { Bar } from '../src/lib/types';

async function main() {
  const days = +(process.argv[2] || 120);
  const syms = [...new Set([...alertCoins(), ...(await kucoinTopCoins(40).catch(() => []))])];
  const data: Record<string, Bar[]> = {};
  for (const s of syms) { try { data[s] = (await kucoinCandles(s, '1D', 1500)).bars; } catch { /* skip */ } }
  const btc = data.BTC; if (!btc) throw new Error('no BTC data');
  const dates = btc.map(b => b.t).slice(-days - 3, -3);
  let n = 0; const R: number[] = []; const B: Record<string, number[]> = {};
  for (const d of dates) {
    const idx = btc.filter(b => b.t < d);
    for (const s of Object.keys(data)) {
      const all = data[s], cut = all.filter(b => b.t < d), next = all.filter(b => b.t >= d).slice(0, 3);
      if (next.length < 3) continue;
      const x = setupCheck(s, cut, s === 'BTC' ? null : idx); if (!x) continue;
      n++;
      const up = x.dir === 'up';
      if (next.findIndex(b => up ? b.h > x.level * 1.003 : b.l < x.level * 0.997) < 0) continue;
      const risk = Math.abs(x.level - x.invalid) || x.atr, r = (up ? next[2].c - x.level : x.level - next[2].c) / risk;
      R.push(r);
      for (const k of [`${x.points}pts`, x.dir]) (B[k] ||= []).push(r);
    }
  }
  const st = (a: number[]) => `${a.length} triggered, ${a.filter(r => r > 0).length} in profit, avg ${(a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(2)}R`;
  console.log(`${Object.keys(data).length} coins, last ${dates.length} days: ${n} setups (${(n / dates.length).toFixed(1)}/day); ${st(R)} after 3 days, before fees.`);
  for (const [k, a] of Object.entries(B).sort()) console.log(`  ${k}: ${st(a)}`);
}
main().catch(e => { console.error((e as Error).message); process.exit(1); });
