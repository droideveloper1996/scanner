import type { Bar } from './types.ts';

/** Yahoo Finance chart endpoint (unofficial, no key). NSE tickers are SYMBOL.NS; indices are ^NSEI / ^NSEBANK. Override the base only for tests. */
const BASE = () => process.env.YAHOO_API_BASE || 'https://query1.finance.yahoo.com';
const YMAP: Record<string, string> = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK' };
export const yahooSym = (sym: string) => YMAP[sym] ?? `${sym}.NS`;

export class UpstreamError extends Error {
  code: 'not_listed' | 'unavailable';
  constructor(code: 'not_listed' | 'unavailable', message: string) { super(message); this.code = code; }
}

type Chart = { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] } }[]; error?: { description?: string } | null } };

/** interval: '15m' | '60m' | '1d'. range: '5d' | '60d'. Returns bars oldest first; the newest may still be forming. */
export async function getBars(sym: string, interval: '15m' | '60m' | '1d', range: string): Promise<Bar[]> {
  const url = `${BASE()}/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?interval=${interval}&range=${range}`;
  let r: Response;
  try { r = await fetch(url, { cache: 'no-store', headers: { 'user-agent': 'Mozilla/5.0 (scanner)' }, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new UpstreamError('unavailable', (e as Error).message); }
  if (r.status === 404) throw new UpstreamError('not_listed', 'not found');
  if (!r.ok) throw new UpstreamError('unavailable', `HTTP ${r.status}`);
  const j = (await r.json()) as Chart;
  const res = j.chart?.result?.[0], q = res?.indicators?.quote?.[0];
  if (!res || !q || !res.timestamp) throw new UpstreamError('not_listed', j.chart?.error?.description || 'no data');
  const bars: Bar[] = [];
  res.timestamp.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if ([o, h, l, c].every(x => x != null && Number.isFinite(x))) bars.push({ t: t * 1000, o: o!, h: h!, l: l!, c: c!, v: q.volume[i] ?? 0 });
  });
  return bars.sort((a, b) => a.t - b.t);
}
