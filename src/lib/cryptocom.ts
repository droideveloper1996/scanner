import type { Bar, Ticker, TfId } from './types';

/** Crypto.com Exchange public market data. No key needed. Override the base only for tests. */
const BASE = () => process.env.CRYPTO_API_BASE || 'https://api.crypto.com/exchange/v1/public';

export class UpstreamError extends Error {
  constructor(public code: 'not_listed' | 'unavailable', message: string) { super(message); }
}

async function call(path: string, params: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${BASE()}/${path}${qs.toString() ? '?' + qs : ''}`;
  let r: Response;
  try { r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new UpstreamError('unavailable', (e as Error).message); }
  let j: { code?: number; message?: string; result?: unknown } | null = null;
  try { j = await r.json(); } catch { /* non-JSON */ }
  if (j && j.code === 0) return j.result as Record<string, unknown>;
  if (r.status === 400 || (j && j.code)) throw new UpstreamError('not_listed', j?.message || `HTTP ${r.status}`);
  throw new UpstreamError('unavailable', `HTTP ${r.status}`);
}

type RawCandle = { o: string; h: string; l: string; c: string; v: string; t: number };

export async function getCandles(inst: string, tf: TfId, count: number): Promise<Bar[]> {
  const res = await call('get-candlestick', { instrument_name: inst, timeframe: tf, count });
  const raw = ((res.data as RawCandle[]) || []);
  const bars = raw.map(b => ({ t: b.t < 1e12 ? b.t * 1000 : b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }))
    .filter(b => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
  return bars.sort((a, b) => a.t - b.t);
}

/** Tries SYM_USD, then SYM_USDT. */
export async function getCandlesFor(sym: string, tf: TfId, count: number): Promise<{ inst: string; bars: Bar[] }> {
  try { const inst = `${sym}_USD`; return { inst, bars: await getCandles(inst, tf, count) }; }
  catch (e) {
    if (!(e instanceof UpstreamError) || e.code !== 'not_listed') throw e;
    const inst = `${sym}_USDT`; return { inst, bars: await getCandles(inst, tf, count) };
  }
}

type RawTicker = { i: string; a: string | null; c: string | null; vv: string | null };

export async function getTickers(): Promise<Record<string, Ticker>> {
  const res = await call('get-tickers', {});
  const out: Record<string, Ticker> = {};
  for (const x of ((res.data as RawTicker[]) || [])) {
    const key = String(x.i).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const last = Number(x.a);
    if (!Number.isFinite(last)) continue;
    out[key] = { last, chg: x.c != null && x.c !== '' ? Number(x.c) * 100 : null, vol: x.vv ? Number(x.vv) : null };
  }
  return out;
}

const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'USDE', 'TUSD', 'USDS', 'USD1', 'RLUSD', 'EUR', 'EURC', 'GBP', 'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'CBBTC']);

/** The most-traded spot coins on Crypto.com right now, by 24h USD volume (stablecoins, fiat and wrapped tokens left out). */
export async function topCoinsByVolume(n: number, minUsd = 1_000_000): Promise<string[]> {
  const res = await call('get-tickers', {});
  const vol = new Map<string, number>();
  for (const x of ((res.data as RawTicker[]) || [])) {
    const m = /^([A-Z0-9]+?)_?(USDT|USD)$/.exec(String(x.i).toUpperCase()); // spot only: perps carry a -PERP suffix
    if (!m || STABLE.has(m[1])) continue;
    const v = Number(x.vv);
    if (Number.isFinite(v)) vol.set(m[1], (vol.get(m[1]) ?? 0) + v);
  }
  return [...vol].filter(([, v]) => v >= minUsd).sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s);
}
