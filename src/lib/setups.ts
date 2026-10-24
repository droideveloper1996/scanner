/** Pre-breakout setups ("opportunity detection"): stocks coiled near a key daily level with trend, relative strength
 *  and volume pointing one way. Crypto port of the stock detector: bearish = SHORT watch, bullish = LONG watch, relative strength vs BTC. A setup is a heads-up, not a trade:
 *  the trade idea only triggers when price closes through the level (checked on 15m bars). Alerts only, never orders. */
import type { Bar } from './types';
import { ema, trueRange, wilder } from './indicators';

export type Setup = {
  sym: string; dir: 'up' | 'down'; points: number; max: number; reasons: string[];
  close: number; level: number; dist: number; invalid: number; atr: number;
};

export const px = (x: number) => x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toPrecision(4);
const pct = (a: number, b: number) => (a / b - 1) * 100;
const hi = (b: Bar[]) => Math.max(...b.map(x => x.h)), lo = (b: Bar[]) => Math.min(...b.map(x => x.l));

/** daily: closed daily bars (oldest first). index: BTC's daily bars for relative strength (null for BTC). */
export function setupCheck(sym: string, daily: Bar[], index: Bar[] | null): Setup | null {
  if (daily.length < 60) return null;
  const C = daily.map(b => b.c), H = daily.map(b => b.h), L = daily.map(b => b.l), n = C.length - 1, close = C[n];
  const e20 = ema(C, 20)[n]!, e50 = ema(C, 50)[n]!;
  const tr = trueRange(H, L, C), atr = wilder(tr, 14)[n] ?? 0;
  const atr5 = tr.slice(-5).reduce((s, x) => s + x, 0) / 5, atr20 = tr.slice(-20).reduce((s, x) => s + x, 0) / 20;
  const last20 = daily.slice(-20), hi20 = hi(last20), lo20 = lo(last20);
  const yr = daily.slice(-365), yl = yr.length >= 250 ? '1-year' : `${yr.length}-day`, hi52 = hi(yr), lo52 = lo(yr);
  const ret20 = pct(close, C[n - 20]);
  let rs: number | null = null;
  if (index && index.length > 21 && sym !== 'BTC') { const I = index.map(b => b.c), k = I.length - 1; rs = ret20 - pct(I[k], I[k - 20]); }
  const recentHi = hi(daily.slice(-10)), priorHi = hi(daily.slice(-20, -10)), recentLo = lo(daily.slice(-10)), priorLo = lo(daily.slice(-20, -10));
  const v10 = daily.slice(-10), downVol = v10.filter((b, i) => b.c < (i ? v10[i - 1].c : b.o)).reduce((s, b) => s + b.v, 0);
  const upVol = v10.filter((b, i) => b.c >= (i ? v10[i - 1].c : b.o)).reduce((s, b) => s + b.v, 0);
  const squeeze = atr20 > 0 && atr5 / atr20 < 0.8;

  const score = (dir: 'up' | 'down'): Setup | null => {
    const up = dir === 'up', level = up ? hi20 : lo20, dist = Math.abs(pct(close, level));
    // must be close to the level: within 2% or 1 ATR, and not already through it
    if (dist > Math.max(2, (atr / close) * 100) || (up ? close > level : close < level)) return null;
    const r: string[] = [];
    if (up ? close > e20 && e20 > e50 : close < e20 && e20 < e50) r.push(up ? 'above 20 & 50-day averages' : 'below 20 & 50-day averages');
    if (rs != null && (up ? rs > 5 : rs < -5)) r.push(`${up ? 'stronger' : 'weaker'} than BTC by ${Math.abs(rs).toFixed(1)}% in 20 days`);
    if (up ? recentLo > priorLo : recentHi < priorHi) r.push(up ? 'higher lows' : 'lower highs');
    if (squeeze) r.push(`range tightening (ATR5/ATR20 ${(atr5 / atr20).toFixed(2)})`);
    if (up ? upVol > downVol * 1.3 : downVol > upVol * 1.3) r.push(`${up ? 'buying' : 'selling'} volume heavier (${Math.min(9.9, (up ? upVol / (downVol || 1) : downVol / (upVol || 1))).toFixed(1)}x)`);
    if (up ? pct(hi52, close) < 5 : pct(close, lo52) < 5) r.push(up ? `near ${yl} high $${px(hi52)}` : `near ${yl} low $${px(lo52)}`);
    if (r.length < 4) return null;
    const invalid = up ? Math.min(e20, close - 1.5 * atr) : Math.max(e20, close + 1.5 * atr);
    return { sym, dir, points: r.length, max: 6, reasons: r, close, level, dist, invalid, atr };
  };
  return score('down') ?? score('up');
}

/** One-line trade idea. Spot can only go long; a short needs perpetual futures or options (higher risk, liquidation). */
export const cryptoIdea = (dir: 'up' | 'down') => dir === 'up'
  ? 'Idea: buy spot on the trigger, stop at the cancel level, size so the stop costs at most 1-1.5% of the account.'
  : 'Idea: exit or avoid longs. Shorting needs perpetual futures or options: high risk, keep size small and use the cancel level as stop.';
