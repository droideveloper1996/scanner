import type { Bar } from './types.ts';
import { tfDef } from './types.ts';
import { analyse } from './signal.ts';
import { trueRange, wilder } from './indicators.ts';
import { getBars, UpstreamError } from './yahoo.ts';
import { watchList, NAMES, INDEXES } from './universe.ts';
import { getStore } from './store.ts';
import { sendTelegram, telegramConfigured } from './telegram.ts';

export type AlertRec = { at: string; sym: string; kind: 'signal' | 'break'; text: string; delivered: boolean };
export type AlertState = {
  last: Record<string, string>;                       // last 1h label per stock
  breaks: Record<string, { dir: 'up' | 'down'; at: string }>;
  recent: AlertRec[];
  checked: string | null;
};
export const STATE_KEY = 'stock-alerts-state';
const emptyState = (): AlertState => ({ last: {}, breaks: {}, recent: [], checked: null });

export const fmt = (x: number) => x.toLocaleString('en-IN', { minimumFractionDigits: x >= 100 ? 2 : 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const ist = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(11, 16) + ' IST';

/** NSE session ends 10:00 UTC (15:30 IST). A bar counts as closed once its interval has passed, or the session is over. */
export function closedBars(bars: Bar[], ms: number, now: number): Bar[] {
  const last = bars[bars.length - 1];
  if (!last) return bars;
  const d = new Date(last.t); const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 0);
  return now < Math.min(last.t + ms, end) ? bars.slice(0, -1) : bars;
}

const atr15 = (c: Bar[]) => { const a = wilder(trueRange(c.map(b => b.h), c.map(b => b.l), c.map(b => b.c)), 14); return a[a.length - 1] ?? 0; };

type Plan = { side: 'LONG' | 'AVOID'; entry: number; stop: number; t1: number; t2: number; far: boolean };
function plan(dir: 'up' | 'down', entry: number, stop: number): Plan {
  const R = Math.abs(entry - stop) || entry * 0.01, s = dir === 'up' ? 1 : -1;
  return { side: dir === 'up' ? 'LONG' : 'AVOID', entry, stop, t1: entry + s * R, t2: entry + s * 2 * R, far: R / entry > 0.04 };
}
function planBlock(p: Plan) {
  const row = (k: string, v: string) => `${k.padEnd(7)}₹${v}`;
  const lines = p.side === 'LONG'
    ? [row('Entry', fmt(p.entry)), row('Stop', fmt(p.stop)), row('T1 +1R', fmt(p.t1) + '  (then stop to entry)'), row('T2 +2R', fmt(p.t2))]
    : [row('Now', fmt(p.entry)), row('Break', fmt(p.stop)), row('Next', fmt(p.t1) + ' / ' + fmt(p.t2))];
  return `<pre>${lines.join('\n')}</pre>` + (p.far ? '\n⚠️ Stop is more than 4% away: size down.' : '') + (p.side === 'AVOID' ? '\nAvoid buying. Short only through puts in F&amp;O.' : '');
}
const head = (sym: string) => `<b>${esc(sym)}</b>${NAMES[sym] && NAMES[sym] !== sym ? ' · ' + esc(NAMES[sym]) : ''}`;
const link = (sym: string) => INDEXES.has(sym) ? '' : `\n<a href="https://groww.in/search?q=${encodeURIComponent(sym)}">Open in Groww</a>`;

/* ---- 1h signal entering Strong Buy / Strong Sell ---- */
export function strongCheck(sym: string, bars1h: Bar[], now: number) {
  const tf = tfDef('1h');
  const c = closedBars(bars1h, tf.ms, now);
  if (c.length < 36) return null;
  const a = analyse(c, tf);
  const close = c[c.length - 1].c, stop = a.ST.line[a.n];
  return { sym, label: a.label, score: a.score, close, rsi: Math.round((a.R[a.n] ?? 0) * 10) / 10, stop, adx: a.adx, candle: c[c.length - 1].t };
}
const strongText = (r: NonNullable<ReturnType<typeof strongCheck>>) => {
  const up = r.label.includes('Buy');
  return `${up ? '▲' : '▼'} ${head(r.sym)}\n${r.label} on 1h · score ${r.score > 0 ? '+' : ''}${r.score} · RSI ${r.rsi}${r.adx != null ? ` · ADX ${r.adx.toFixed(0)}` : ''}\n` +
    (r.stop ? planBlock(plan(up ? 'up' : 'down', r.close, r.stop)) : `Price ₹${fmt(r.close)}`) + link(r.sym);
};

/* ---- 15m breakouts: one-session high/low break on volume, or a fast 1h move ---- */
const LOOK = 26, WIN = 4, VOLX = 1.5, COOLDOWN = 3 * 3600e3;   // 26 x 15m bars = about one session
const MOVE = (s: string) => INDEXES.has(s) ? 0.8 : 2.0, MARGIN = (s: string) => (INDEXES.has(s) ? 0.15 : 0.3) / 100;

export function breakCheck(sym: string, bars15: Bar[], now: number) {
  const c = closedBars(bars15, 15 * 60e3, now);
  if (c.length < LOOK + WIN + 1) return null;
  const n = c.length - 1, m = MARGIN(sym);
  let hit: { dir: 'up' | 'down'; kind: 'breakout' | 'breakdown' | 'move'; level: number | null; volx: number | null } | null = null;
  for (let i = n - WIN + 1; i <= n; i++) {
    const prior = c.slice(i - LOOK, i);
    const hi = Math.max(...prior.map(r => r.h)), lo = Math.min(...prior.map(r => r.l));
    const av = prior.reduce((s, r) => s + r.v, 0) / LOOK, vx = av ? c[i].v / av : 0;
    const needVol = !INDEXES.has(sym);   // index candles carry no volume on Yahoo
    if (c[i].c > hi * (1 + m) && c[n].c > hi && (!needVol || vx >= VOLX)) hit = { dir: 'up', kind: 'breakout', level: hi, volx: needVol ? vx : null };
    else if (c[i].c < lo * (1 - m) && c[n].c < lo && (!needVol || vx >= VOLX)) hit = { dir: 'down', kind: 'breakdown', level: lo, volx: needVol ? vx : null };
  }
  const move = (c[n].c / c[n - WIN].c - 1) * 100;
  if (!hit && Math.abs(move) >= MOVE(sym)) hit = { dir: move > 0 ? 'up' : 'down', kind: 'move', level: null, volx: null };
  return hit ? { ...hit, sym, close: c[n].c, move: Math.round(move * 100) / 100, atr: atr15(c) } : null;
}
const breakText = (h: NonNullable<ReturnType<typeof breakCheck>>) => {
  const up = h.dir === 'up', mv = `${h.move > 0 ? '+' : ''}${h.move.toFixed(1)}%`;
  const what = h.kind === 'move'
    ? `${up ? 'surged' : 'dropped'} ${mv} in 1h`
    : `${h.kind} ${up ? 'above' : 'below'} session ${up ? 'high' : 'low'} ₹${fmt(h.level!)}${h.volx ? ` · volume ${h.volx.toFixed(1)}x` : ''} · ${mv} 1h`;
  const stop = h.level != null ? (up ? h.level * 0.995 : h.level * 1.005) : (up ? h.close - 2 * h.atr : h.close + 2 * h.atr);
  return `${up ? '🚀' : '🔻'} ${head(h.sym)}\n${what}\n${planBlock(plan(h.dir, h.close, stop))}${link(h.sym)}`;
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
  const names = watchList();
  const skipped: string[] = [];
  const found: AlertRec[] = [];
  const labels: Record<string, string> = {};
  const nextBreaks = { ...state.breaks };
  const at = new Date(now).toISOString();
  let newest = 0;

  await pool(names, 5, async sym => {
    try {
      const [h1, m15] = await Promise.all([getBars(sym, '60m', '60d'), getBars(sym, '15m', '5d')]);
      newest = Math.max(newest, m15.length ? m15[m15.length - 1].t : 0);
      const s = strongCheck(sym, h1, now);
      if (s) {
        labels[sym] = s.label;
        if (s.label.startsWith('Strong') && s.label !== state.last[sym] && !seeding)
          found.push({ at, sym, kind: 'signal', text: strongText(s), delivered: false });
      } else skipped.push(`${sym}: too few 1h candles`);
      const b = breakCheck(sym, m15, now);
      if (b && !seeding) {
        const prev = state.breaks[sym];
        if (!(prev && prev.dir === b.dir && now - Date.parse(prev.at) < COOLDOWN)) {
          found.push({ at, sym, kind: 'break', text: breakText(b), delivered: false });
          nextBreaks[sym] = { dir: b.dir, at };
        }
      }
    } catch (e) {
      skipped.push(`${sym}: ${e instanceof UpstreamError && e.code === 'not_listed' ? 'not listed' : (e as Error).message}`);
    }
  });
  found.sort((a, b) => a.sym.localeCompare(b.sym));

  const stale = newest === 0 || now - newest > 45 * 60e3;   // no fresh 15m bar: holiday, or Yahoo is lagging
  let delivered = false;
  if (found.length && telegramConfigured() && !dry && !stale) {
    await sendTelegram(`<b>Stock alerts · ${ist(now)}</b>\n\n` + found.map(f => f.text).join('\n\n')); // throws on failure: state is not saved, so the next run retries
    delivered = true;
  }
  for (const f of found) f.delivered = delivered;

  if (!dry && !stale) {
    await store.set(STATE_KEY, {
      last: { ...state.last, ...labels },
      breaks: nextBreaks,
      recent: [...found, ...state.recent].slice(0, 40),
      checked: at,
    } satisfies AlertState);
  }
  return { checkedAt: at, seeded: seeding, dry, stale, stocks: names.length, storage: store.kind, telegram: telegramConfigured(), alerts: found, skipped };
}
