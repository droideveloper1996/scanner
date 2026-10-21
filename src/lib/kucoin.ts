import type { Bar, TfId } from './types';

/** KuCoin public market data (no key). Used for the wider "top coins" list, because Crypto.com
 *  only has deep liquidity in a handful of coins. Override the base only for tests. */
const BASE = () => process.env.KUCOIN_API_BASE || 'https://api.kucoin.com/api/v1';
const TF: Record<TfId, string> = { '15m': '15min', '1h': '1hour', '4h': '4hour', '1D': '1day' };

async function get(path: string) {
  const r = await fetch(`${BASE()}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  const j = (await r.json().catch(() => null)) as { code?: string; data?: unknown; msg?: string } | null;
  if (!r.ok || !j || j.code !== '200000') throw new Error(`KuCoin ${j?.msg || 'HTTP ' + r.status}`);
  return j.data;
}

const SKIP = /^(USDT|USDC|DAI|FDUSD|PYUSD|USDE|TUSD|USDS|USD1|USDD|EUR|EURC|PAXG|XAUT|WBTC|WETH|STETH)$|\d[LS]$|(UP|DOWN|BULL|BEAR)$/;

/** Top USDT pairs on KuCoin by 24h USD turnover (stablecoins, leveraged and wrapped tokens left out). */
export async function kucoinTopCoins(n: number, minUsd = 2_000_000): Promise<string[]> {
  const d = (await get('/market/allTickers')) as { ticker: { symbol: string; volValue: string }[] };
  return d.ticker
    .map(t => ({ base: t.symbol.endsWith('-USDT') ? t.symbol.slice(0, -5) : '', v: Number(t.volValue) }))
    .filter(x => x.base && !SKIP.test(x.base) && x.v >= minUsd)
    .sort((a, b) => b.v - a.v).slice(0, n).map(x => x.base);
}

export async function kucoinCandles(sym: string, tf: TfId, count: number): Promise<{ inst: string; bars: Bar[] }> {
  const inst = `${sym}-USDT`;
  const rows = (await get(`/market/candles?type=${TF[tf]}&symbol=${inst}`)) as string[][];
  const bars = rows.map(r => ({ t: Number(r[0]) * 1000, o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    .filter(b => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
  return { inst, bars: bars.slice(-count) };
}
