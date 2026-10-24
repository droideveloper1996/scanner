import type { Bar, TfDef } from './types.ts';
import { adx, ema, macd, rsi, sma, supertrend, trueRange, vwap, wilder, type Series } from './indicators.ts';

export type Vote = { name: string; val: number | null; score: number; txt: string };
export type Kind = 'buy' | 'sell' | 'neutral';

/** Five votes (+1/-1/0): Supertrend(10,3), EMA 9 vs 21, MACD histogram, RSI 14 (>55 / <45),
 *  price vs VWAP (intraday) or 50-candle average. Score >=4 Strong Buy, >=2 Buy, <=-4 Strong Sell,
 *  <=-2 Sell. ADX(14) < 20 downgrades "Strong". */
export function analyse(bars: Bar[], tf: TfDef) {
  const H = bars.map(b => b.h), L = bars.map(b => b.l), C = bars.map(b => b.c), n = C.length - 1;
  const e9 = ema(C, 9), e21 = ema(C, 21), R = rsi(C), M = macd(C), ST = supertrend(H, L, C), A = adx(H, L, C);
  const atr = wilder(trueRange(H, L, C), 14);
  const useV = tf.intraday && bars.some(b => b.v > 0);
  const ref: Series = useV ? vwap(bars) : sma(C, 50);
  const refName = useV ? 'VWAP' : '50-candle avg';
  const sma200 = tf.id === '1D' ? sma(C, 200) : null;
  const votes: Vote[] = [];
  const v = (name: string, val: number | null, score: number, txt: string) => votes.push({ name, val, score, txt });
  v('Supertrend (10,3)', ST.line[n], ST.dir[n] || 0, ST.dir[n] === 1 ? 'Uptrend' : ST.dir[n] === -1 ? 'Downtrend' : '–');
  const d9 = e9[n] != null && e21[n] != null ? e9[n]! - e21[n]! : null;
  v('EMA 9 vs 21', d9, d9 == null ? 0 : d9 > 0 ? 1 : d9 < 0 ? -1 : 0, d9 != null && d9 > 0 ? 'Bullish cross' : 'Bearish cross');
  const mh = M.h[n], mhp = M.h[n - 1];
  v('MACD histogram', mh, mh == null ? 0 : mh > 0 ? 1 : mh < 0 ? -1 : 0,
    mh != null && mh > 0 ? (mhp != null && mh > mhp ? 'Rising above 0' : 'Above 0, fading') : (mhp != null && mh != null && mh < mhp ? 'Falling below 0' : 'Below 0, improving'));
  const r = R[n];
  v('RSI (14)', r, r == null ? 0 : r > 55 ? 1 : r < 45 ? -1 : 0,
    r == null ? '–' : r >= 70 ? 'Overbought' : r <= 30 ? 'Oversold' : r > 55 ? 'Bullish zone' : r < 45 ? 'Bearish zone' : 'Neutral');
  v('Price vs ' + refName, ref[n], ref[n] == null ? 0 : C[n] > ref[n]! ? 1 : C[n] < ref[n]! ? -1 : 0,
    ref[n] == null ? '–' : C[n] > ref[n]! ? 'Above' : 'Below');
  const score = votes.reduce((s, x) => s + x.score, 0);
  const ax = A.adx[n], weak = ax != null && ax < 20;
  let label = score >= 4 ? 'Strong Buy' : score >= 2 ? 'Buy' : score <= -4 ? 'Strong Sell' : score <= -2 ? 'Sell' : 'Neutral';
  if (weak && label.startsWith('Strong')) label = label.replace('Strong ', '');
  const kind: Kind = label.includes('Buy') ? 'buy' : label.includes('Sell') ? 'sell' : 'neutral';
  const marks: { i: number; s: 1 | -1 }[] = [];
  for (let i = 1; i <= n; i++) {
    if (ST.dir[i] === 1 && ST.dir[i - 1] === -1 && e9[i]! >= e21[i]!) marks.push({ i, s: 1 });
    if (ST.dir[i] === -1 && ST.dir[i - 1] === 1 && e9[i]! <= e21[i]!) marks.push({ i, s: -1 });
  }
  let lastFlip: { i: number; dir: number } | null = null;
  for (let i = n; i > 0; i--) if (ST.dir[i] !== ST.dir[i - 1] && ST.dir[i - 1]) { lastFlip = { i, dir: ST.dir[i] }; break; }
  return {
    bars, C, e9, e21, R, M, ST, A, atr, ref, refName, sma200, votes, score, label, kind, weak,
    adx: ax, pdi: A.pdi[n], mdi: A.mdi[n], marks, lastFlip, n,
  };
}
export type Analysis = ReturnType<typeof analyse>;
