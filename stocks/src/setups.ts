/** Pre-breakout setups ("opportunity detection"): stocks coiled near a key daily level with trend, relative strength
 *  and volume pointing one way. Bearish setup = PUT watch, bullish = CALL watch. A setup is a heads-up, not a trade:
 *  the trade idea only triggers when price closes through the level (checked on 15m bars). Alerts only, never orders. */
import type { Bar } from './types.ts';
import { ema, trueRange, wilder } from './indicators.ts';
import { INDEXES } from './universe.ts';

/** Underlyings with NSE stock options, checked in Groww (24 Oct 2026). Others: options not confirmed. */
export const FNO = new Set(['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL', 'ITC', 'LT', 'AXISBANK',
  'BAJFINANCE', 'MARUTI', 'SUNPHARMA', 'TITAN', 'HINDUNILVR', 'M&M', 'NTPC', 'ADANIPORTS', 'BEL', 'TATASTEEL', 'HAL', 'KOTAKBANK', 'INDHOTEL', 'SWIGGY']);

export type Setup = {
  sym: string; dir: 'up' | 'down'; points: number; max: number; reasons: string[];
  close: number; level: number; dist: number; invalid: number; atr: number;
};

const pct = (a: number, b: number) => (a / b - 1) * 100;
const hi = (b: Bar[]) => Math.max(...b.map(x => x.h)), lo = (b: Bar[]) => Math.min(...b.map(x => x.l));

/** daily: closed daily bars (oldest first). index: the Nifty's daily bars for relative strength. */
export function setupCheck(sym: string, daily: Bar[], index: Bar[] | null): Setup | null {
  if (daily.length < 60) return null;
  const C = daily.map(b => b.c), H = daily.map(b => b.h), L = daily.map(b => b.l), n = C.length - 1, close = C[n];
  const e20 = ema(C, 20)[n]!, e50 = ema(C, 50)[n]!;
  const tr = trueRange(H, L, C), atr = wilder(tr, 14)[n] ?? 0;
  const atr5 = tr.slice(-5).reduce((s, x) => s + x, 0) / 5, atr20 = tr.slice(-20).reduce((s, x) => s + x, 0) / 20;
  const last20 = daily.slice(-20), hi20 = hi(last20), lo20 = lo(last20);
  const yr = daily.slice(-250), hi52 = hi(yr), lo52 = lo(yr);
  const ret20 = pct(close, C[n - 20]);
  let rs: number | null = null;
  if (index && index.length > 21 && !INDEXES.has(sym)) { const I = index.map(b => b.c), k = I.length - 1; rs = ret20 - pct(I[k], I[k - 20]); }
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
    if (rs != null && (up ? rs > 3 : rs < -3)) r.push(`${up ? 'stronger' : 'weaker'} than Nifty by ${Math.abs(rs).toFixed(1)}% in 20 days`);
    if (up ? recentLo > priorLo : recentHi < priorHi) r.push(up ? 'higher lows' : 'lower highs');
    if (squeeze) r.push(`range tightening (ATR5/ATR20 ${(atr5 / atr20).toFixed(2)})`);
    if (up ? upVol > downVol * 1.3 : downVol > upVol * 1.3) r.push(`${up ? 'buying' : 'selling'} volume heavier (${Math.min(9.9, (up ? upVol / (downVol || 1) : downVol / (upVol || 1))).toFixed(1)}x)`);
    if (up ? pct(hi52, close) < 5 : pct(close, lo52) < 5) r.push(up ? `near 52-week high ₹${hi52.toFixed(2)}` : `near 52-week low ₹${lo52.toFixed(2)}`);
    if (r.length < 4) return null;
    const invalid = up ? Math.min(e20, close - 1.5 * atr) : Math.max(e20, close + 1.5 * atr);
    return { sym, dir, points: r.length, max: 6, reasons: r, close, level, dist, invalid, atr };
  };
  return score('down') ?? score('up');
}

/** Nearest monthly expiry (last Tuesday) with at least 8 days left, else next month's. */
export function monthlyExpiry(now: number) {
  const lastTue = (y: number, m: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1); return d; };
  const t = new Date(now); let e = lastTue(t.getUTCFullYear(), t.getUTCMonth());
  if ((e.getTime() - now) / 864e5 < 8) e = lastTue(t.getUTCFullYear(), t.getUTCMonth() + 1);
  return e.toISOString().slice(0, 10);
}
const step = (p: number) => p < 100 ? 2.5 : p < 250 ? 5 : p < 500 ? 10 : p < 1000 ? 20 : p < 2500 ? 50 : p < 5000 ? 100 : 250;
export const atmStrike = (p: number, sym: string) => { const s = sym === 'NIFTY' ? 50 : sym === 'BANKNIFTY' ? 100 : step(p); return Math.round(p / s) * s; };

/** One-line option idea for a direction, honest about whether options exist. */
export function optionIdea(sym: string, dir: 'up' | 'down', price: number, now: number) {
  const kind = dir === 'up' ? 'CALL (CE)' : 'PUT (PE)';
  if (!FNO.has(sym)) return dir === 'up' ? 'Idea: buy the stock on the trigger (options not confirmed for this name).' : 'Idea: avoid or exit longs (no confirmed options to short with).';
  return `Idea: buy ${kind} near ₹${atmStrike(price, sym)} strike, ${monthlyExpiry(now)} expiry. Risk only the premium; exit if the trigger fails.`;
}
