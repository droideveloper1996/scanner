import type { Bar } from './types';
import { tfDef } from './types';
import { analyse } from './signal';
import { getCandlesFor, UpstreamError } from './cryptocom';
import { kucoinCandles, kucoinTopCoins } from './kucoin';
import { alertCoins, alertTop } from './config';
import { getStore } from './store';
import { sendTelegram, telegramConfigured } from './telegram';

export type AlertRec = { at: string; sym: string; kind: 'signal' | 'break'; text: string; delivered: boolean };
export type AlertState = {
  last: Record<string, string>;                       // last 1h label per coin
  breaks: Record<string, { dir: 'up' | 'down'; at: string }>;
  recent: AlertRec[];
  checked: string | null;
};
export const STATE_KEY = 'alerts-state';
const emptyState = (): AlertState => ({ last: {}, breaks: {}, recent: [], checked: null });

export const fmt = (x: number) =>
  x >= 100 ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(4) : String(Number(x.toPrecision(4)));

/** Crypto.com returns the candle that is still forming as the newest one. Drop it so a signal only counts once its candle has closed. */
export function closedBars(bars: Bar[], ms: number, now: number): Bar[] {
  const last = bars[bars.length - 1];
  return last && now - last.t < ms ? bars.slice(0, -1) : bars;
}

/* ---- 1h signal entering Strong Buy / Strong Sell ---- */
export function strongCheck(sym: string, bars1h: Bar[], now: number) {
  const tf = tfDef('1h');
  const c = closedBars(bars1h, tf.ms, now);
  if (c.length < 36) return null;
  const a = analyse(c, tf);
  const close = c[c.length - 1].c, stop = a.ST.line[a.n];
  return { sym, label: a.label, score: a.score, close, rsi: Math.round((a.R[a.n] ?? 0) * 10) / 10, stop, candle: c[c.length - 1].t };
}
const strongText = (r: NonNullable<ReturnType<typeof strongCheck>>) =>
  `${r.label.includes('Buy') ? '▲' : '▼'} ${r.sym} ${r.label} · $${fmt(r.close)} · score ${r.score > 0 ? '+' : ''}${r.score} · RSI ${r.rsi}${r.stop ? ` · stop $${fmt(r.stop)}` : ''} (1h)`;

/* ---- 15m breakouts: 8h high/low break on volume, or a fast 1h move ---- */
const LOOK = 32, WIN = 4, VOLX = 1.5, COOLDOWN = 4 * 3600e3;
const MOVE: Record<string, number> = { BTC: 2.5, ETH: 2.5 }, MARGIN: Record<string, number> = { BTC: 0.5, ETH: 0.5 };

export function breakCheck(sym: string, bars15: Bar[], now: number, moveDefault = 4.0) {
  const c = closedBars(bars15, 15 * 60e3, now);
  if (c.length < LOOK + WIN + 1) return null;
  const n = c.length - 1, m = (MARGIN[sym] ?? 1.0) / 100;
  let hit: { dir: 'up' | 'down'; kind: 'breakout' | 'breakdown' | 'move'; level: number | null; volx: number | null } | null = null;
  for (let i = n - WIN + 1; i <= n; i++) {
    const prior = c.slice(i - LOOK, i);
    const hi = Math.max(...prior.map(r => r.h)), lo = Math.min(...prior.map(r => r.l));
    const av = prior.reduce((s, r) => s + r.v, 0) / LOOK, vx = av ? c[i].v / av : 0;
    if (c[i].c > hi * (1 + m) && c[n].c > hi && vx >= VOLX) hit = { dir: 'up', kind: 'breakout', level: hi, volx: vx };
    else if (c[i].c < lo * (1 - m) && c[n].c < lo && vx >= VOLX) hit = { dir: 'down', kind: 'breakdown', level: lo, volx: vx };
  }
  const move = (c[n].c / c[n - WIN].c - 1) * 100;
  if (!hit && Math.abs(move) >= (MOVE[sym] ?? moveDefault)) hit = { dir: move > 0 ? 'up' : 'down', kind: 'move', level: null, volx: null };
  return hit ? { ...hit, sym, close: c[n].c, move: Math.round(move * 100) / 100 } : null;
}
const breakText = (h: NonNullable<ReturnType<typeof breakCheck>>) => {
  const arrow = h.dir === 'up' ? '🚀' : '🔻';
  const what = h.kind === 'move'
    ? `${h.dir === 'up' ? 'surged' : 'dropped'} ${h.move > 0 ? '+' : ''}${h.move.toFixed(1)}% in 1h`
    : `${h.kind} ${h.dir === 'up' ? 'above' : 'below'} 8h ${h.dir === 'up' ? 'high' : 'low'} $${fmt(h.level!)} · vol ${h.volx!.toFixed(1)}x · ${h.move > 0 ? '+' : ''}${h.move.toFixed(1)}% 1h`;
  return `${arrow} ${h.sym} ${what} · now $${fmt(h.close)} (15m)`;
};

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export type RunOptions = { dry?: boolean; now?: number };

export async function runAlerts({ dry = false, now = Date.now() }: RunOptions = {}) {
  const store = getStore();
  const state = (await store.get<AlertState>(STATE_KEY)) ?? emptyState();
  const seeding = state.checked == null;      // first ever run: record labels, do not flood
  let skippedTop = '';
  // The default coins use Crypto.com; the wider top-by-volume list uses KuCoin, which has deeper liquidity in more coins.
  const base = alertCoins();
  const top = alertTop();
  const extra = top ? (await kucoinTopCoins(top).catch(e => { skippedTop = (e as Error).message; return [] as string[]; })).filter(s => !base.includes(s)) : [];
  const coins = [...base, ...extra];
  const fromKucoin = new Set(extra);
  const skipped: string[] = [];
  const found: AlertRec[] = [];
  const labels: Record<string, string> = {};
  const nextBreaks = { ...state.breaks };
  const bars15: Record<string, Bar[]> = {};
  const freshBreaks: NonNullable<ReturnType<typeof breakCheck>>[] = [];
  const at = new Date(now).toISOString();

  await pool(coins, 10, async sym => {
    try {
      const fetchC = fromKucoin.has(sym) ? kucoinCandles : getCandlesFor;
      const [h1, m15] = await Promise.all([fetchC(sym, '1h', 300), fetchC(sym, '15m', 100)]);
      const s = strongCheck(sym, h1.bars, now);
      if (s) {
        labels[sym] = s.label;
        // a coin seen for the first time (e.g. new in the top list) only records its label, so it does not alert on arrival
        if (s.label.startsWith('Strong') && s.label !== state.last[sym] && !seeding && sym in state.last)
          found.push({ at, sym, kind: 'signal', text: strongText(s), delivered: false });
      } else skipped.push(`${sym}: too few 1h candles`);
      bars15[sym] = m15.bars;                       // includes the forming candle (pump book exits use its latest price)
      const b = breakCheck(sym, m15.bars, now, fromKucoin.has(sym) ? 6.0 : 4.0); // smaller top-list coins swing more: 6% for a fast-move alert
      if (b && !seeding) {
        const prev = state.breaks[sym];
        if (!(prev && prev.dir === b.dir && now - Date.parse(prev.at) < COOLDOWN)) {
          found.push({ at, sym, kind: 'break', text: breakText(b), delivered: false });
          nextBreaks[sym] = { dir: b.dir, at };
          freshBreaks.push(b);
        }
      }
    } catch (e) {
      skipped.push(`${sym}: ${e instanceof UpstreamError && e.code === 'not_listed' ? 'not listed' : (e as Error).message}`);
    }
  });
  found.sort((a, b) => a.sym.localeCompare(b.sym));

  let delivered = false;
  if (found.length && telegramConfigured() && !dry) {
    await sendTelegram(found.map(f => f.text).join('\n')); // throws on failure: state is not saved, so the next run retries
    delivered = true;
  }
  for (const f of found) f.delivered = delivered;

  if (!dry) {
    await store.set(STATE_KEY, {
      last: { ...state.last, ...labels },
      breaks: nextBreaks,
      recent: [...found, ...state.recent].slice(0, 40),
      checked: at,
    } satisfies AlertState);
  }
  return { checkedAt: at, seeded: seeding, dry, coins: coins.length, watching: coins.join(","), topList: skippedTop ? `failed: ${skippedTop}` : extra.length, storage: store.kind, telegram: telegramConfigured(), alerts: found, labels, skipped, bars15, freshBreaks };
}

export async function readState() {
  const store = getStore();
  return { state: (await store.get<AlertState>(STATE_KEY)) ?? emptyState(), storage: store.kind };
}
