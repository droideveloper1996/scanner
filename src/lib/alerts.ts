import type { Bar } from './types';
import { tfDef } from './types';
import { analyse } from './signal';
import { getCandlesFor, UpstreamError } from './cryptocom';
import { kucoinCandles, kucoinTopCoins } from './kucoin';
import { alertCoins, alertTop } from './config';
import { getStore } from './store';
import { sendTelegram, telegramConfigured } from './telegram';
import { setupCheck, cryptoIdea, type Setup } from './setups';

export type AlertRec = { at: string; sym: string; kind: 'signal' | 'break'; text: string; delivered: boolean };
export type AlertState = {
  last: Record<string, string>;                       // last 1h label per coin
  breaks: Record<string, { dir: 'up' | 'down'; at: string }>;
  recent: AlertRec[];
  checked: string | null;
  setupDay?: string;                                  // UTC date the daily setups were last computed (daily candle closes 00:00 UTC)
  setups?: (Pick<Setup, 'sym' | 'dir' | 'level' | 'invalid'> & { kucoin?: boolean; triggered?: boolean })[];
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
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (x: number, d = 1) => `${x > 0 ? '+' : ''}${x.toFixed(d)}%`;
const chartLink = (sym: string, kucoin: boolean) => kucoin
  ? `<a href="https://www.kucoin.com/trade/${encodeURIComponent(sym)}-USDT">Chart (KuCoin)</a>`
  : `<a href="https://crypto.com/exchange/trade/${encodeURIComponent(sym)}_USD">Chart (Crypto.com)</a>`;
/** Coin name as a tap-to-open link to its live chart on the exchange the data came from. */
const coinLink = (sym: string, kucoin = false) => `<a href="${kucoin ? `https://www.kucoin.com/trade/${encodeURIComponent(sym)}-USDT` : `https://crypto.com/exchange/trade/${encodeURIComponent(sym)}_USD`}">${esc(sym)}</a>`;
/** Telegram has no tables: a <pre> block with padded columns renders as one (monospace on every app). */
const table = (rows: (string[] | null)[]) =>
  `<pre>${rows.map(r => r ? esc(r[0].padEnd(9) + (r[1] ?? '').padEnd(13) + (r[2] ?? '')).trimEnd() : '─'.repeat(28)).join('\n')}</pre>`;
/** Entry, stop and two targets, the same rules as the paper pump book: +1R = move stop to entry, +2R = exit. */
const STOP_PAST = 0.005, WIDE = 6;
function planRows(long: boolean, entry: number, stop: number): string[][] {
  const risk = Math.abs(entry - stop), d = long ? 1 : -1, rp = (risk / entry) * 100;
  return [
    ['Entry', `$${fmt(entry)}`],
    ['Stop', `$${fmt(stop)}`, pct(-d * rp)],
    ['Target 1', `$${fmt(entry + d * risk)}`, pct(d * rp)],
    ['Target 2', `$${fmt(entry + d * 2 * risk)}`, pct(d * 2 * rp)],
  ];
}
const notes = (long: boolean, entry: number, stop: number, extra: string[]) => {
  const rp = (Math.abs(entry - stop) / entry) * 100;
  const out = [...extra, 'At Target 1 move stop to entry; exit the rest at Target 2'];
  if (!long) out.push('Short = futures only. Spot holders: exit or avoid');
  if (rp > WIDE) out.push(`⚠️ Stop is ${rp.toFixed(1)}% away: wait for a pullback or size small`);
  return out.map(n => `• ${n}`).join('\n');
};
const side = (long: boolean) => (long ? '🟩 LONG' : '🟥 SHORT');

export const strongText = (r: NonNullable<ReturnType<typeof strongCheck>>, kucoin: boolean) => {
  const buy = r.label.includes('Buy');
  const plan = !!r.stop && (buy ? r.stop < r.close : r.stop > r.close);
  const head = `${buy ? '🟢' : '🔴'} <b>${esc(r.label.toUpperCase())} · ${coinLink(r.sym, kucoin)}</b> · 1h${plan ? ` · ${side(buy)}` : ''}`;
  const rows: (string[] | null)[] = [['Price', `$${fmt(r.close)}`], ['Score', `${r.score > 0 ? '+' : ''}${r.score}`, `RSI ${r.rsi}`]];
  if (plan) rows.push(null, ...planRows(buy, r.close, r.stop));
  return [head, table(rows), plan ? notes(buy, r.close, r.stop, ['Stop = Supertrend line']) : '', chartLink(r.sym, kucoin)].filter(Boolean).join('\n');
};

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
  let tr = 0;                                     // 14-bar average true range of the 15m candles, for stops on fast moves
  for (let i = n - 13; i <= n; i++) tr += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  return hit ? { ...hit, sym, close: c[n].c, move: Math.round(move * 100) / 100, atr: tr / 14 } : null;
}
export const breakText = (h: NonNullable<ReturnType<typeof breakCheck>>, kucoin: boolean) => {
  const up = h.dir === 'up';
  const rows: (string[] | null)[] = [['Price', `$${fmt(h.close)}`, `${pct(h.move)} 1h`]];
  let head: string, stop: number, extra: string[];
  if (h.kind === 'move') {
    head = `${up ? '⚡' : '💥'} <b>FAST ${up ? 'PUMP' : 'DUMP'} · ${coinLink(h.sym, kucoin)}</b> · 15m · ${side(up)}`;
    stop = up ? h.close - 2 * h.atr : h.close + 2 * h.atr;
    extra = [`No clean 8h ${up ? 'high' : 'low'} break: aggressive entry`, 'Stop = 2× 15m ATR'];
  } else {
    const lvl = h.level!;
    head = `${up ? '🚀' : '🔻'} <b>${up ? 'BREAKOUT' : 'BREAKDOWN'} · ${coinLink(h.sym, kucoin)}</b> · 15m · ${side(up)}`;
    rows.push([up ? '8h high' : '8h low', `$${fmt(lvl)}`, `${pct((h.close / lvl - 1) * 100)} past`], ['Volume', `${h.volx!.toFixed(1)}×`, '8h avg']);
    stop = lvl * (up ? 1 - STOP_PAST : 1 + STOP_PAST);
    extra = [`Or enter on a retest of $${fmt(lvl)}`, `Invalid if a 15m candle closes back ${up ? 'below' : 'above'} $${fmt(lvl)}`];
  }
  rows.push(null, ...planRows(up, h.close, stop));
  return [head, table(rows), notes(up, h.close, stop, extra), chartLink(h.sym, kucoin)].join('\n');
};
/** One Telegram message: a header, then each alert as its own block. Breakouts come first. */
export function alertMessage(found: AlertRec[], now: number) {
  const ist = new Date(now + 5.5 * 3600e3).toISOString().slice(11, 16);
  const order = (a: AlertRec) => (a.kind === 'break' ? 0 : 1);
  const sorted = [...found].sort((a, b) => order(a) - order(b) || a.sym.localeCompare(b.sym));
  const nb = found.filter(f => f.kind === 'break').length, ns = found.length - nb;
  const head = `📊 <b>Crypto scanner</b> · ${ist} IST\n${[nb && `${nb} breakout${nb > 1 ? 's' : ''}`, ns && `${ns} signal${ns > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}`;
  return [head, ...sorted.map(f => f.text), '<i>Paper signals, not financial advice.</i>'].join('\n\n');
}

/* ---- pre-breakout setups (daily, once per UTC day) and their 15m triggers ---- */
const setupText = (x: Setup, kucoin: boolean) => {
  const up = x.dir === 'up';
  return `${up ? '🟢 LONG watch' : '🔴 SHORT watch'} · <b>${coinLink(x.sym, kucoin)}</b>\nSetup ${x.points}/${x.max}: ${x.reasons.map(esc).join(', ')}.\n` +
    `<pre>Now      $${fmt(x.close)}\nTrigger  ${up ? 'above' : 'below'} $${fmt(x.level)} (${x.dist.toFixed(1)}% away)\nCancel   ${up ? 'below' : 'above'} $${fmt(x.invalid)}</pre>\n` +
    `On a 15m close ${up ? 'above' : 'below'} $${fmt(x.level)}: ${esc(cryptoIdea(x.dir))}\n${chartLink(x.sym, kucoin)}`;
};
const triggerText = (x: { sym: string; dir: 'up' | 'down'; level: number; invalid: number; kucoin?: boolean }, close: number, volx: number) => {
  const up = x.dir === 'up';
  return `${up ? '🚀 LONG trigger' : '🔻 SHORT trigger'} · <b>${coinLink(x.sym, !!x.kucoin)}</b> · daily setup\n15m close $${fmt(close)} ${up ? 'above' : 'below'} the setup level $${fmt(x.level)}${volx ? ` · volume ${volx.toFixed(1)}×` : ''}.\n` +
    `${esc(cryptoIdea(x.dir))}\nInvalid if it closes back ${up ? 'below' : 'above'} $${fmt(x.level)}; hard stop $${fmt(x.invalid)}.\n${chartLink(x.sym, !!x.kucoin)}`;
};
const closedDaily = (d: Bar[], now: number) => closedBars(d, 864e5, now);

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

  // daily setups: once per UTC day on the default coins + the top 40 by volume, relative strength vs BTC
  const today = at.slice(0, 10);
  let setups = state.setupDay === today ? (state.setups ?? []) : null;
  const setupCards: string[] = [];
  if (!setups) {
    const scan = [...base, ...extra.slice(0, 40)];
    const daily: Record<string, Bar[]> = {};
    await pool(scan, 10, async sym => {
      try { daily[sym] = closedDaily((await (fromKucoin.has(sym) ? kucoinCandles : getCandlesFor)(sym, '1D', 300)).bars, now); } catch { /* reported by the main loop */ }
    });
    const got: Setup[] = [];
    for (const sym of scan) { const d = daily[sym]; if (!d) continue; const x = setupCheck(sym, d, sym === 'BTC' ? null : daily.BTC ?? null); if (x) got.push(x); }
    got.sort((a, b) => b.points - a.points || a.dist - b.dist);
    got.splice(8);
    setups = got.map(x => ({ sym: x.sym, dir: x.dir, level: x.level, invalid: x.invalid, kucoin: fromKucoin.has(x.sym) }));
    for (const x of got) setupCards.push(setupText(x, fromKucoin.has(x.sym)));
  }

  await pool(coins, 10, async sym => {
    try {
      const fetchC = fromKucoin.has(sym) ? kucoinCandles : getCandlesFor;
      const [h1, m15] = await Promise.all([fetchC(sym, '1h', 300), fetchC(sym, '15m', 100)]);
      const s = strongCheck(sym, h1.bars, now);
      if (s) {
        labels[sym] = s.label;
        // a coin seen for the first time (e.g. new in the top list) only records its label, so it does not alert on arrival
        if (s.label.startsWith('Strong') && s.label !== state.last[sym] && !seeding && sym in state.last)
          found.push({ at, sym, kind: 'signal', text: strongText(s, fromKucoin.has(sym)), delivered: false });
      } else skipped.push(`${sym}: too few 1h candles`);
      bars15[sym] = m15.bars;                       // includes the forming candle (pump book exits use its latest price)
      const su = setups!.find(x => x.sym === sym && !x.triggered);
      if (su) {
        const c = closedBars(m15.bars, 15 * 60e3, now), k = c.length - 1;
        if (k > 32 && c[k].t >= Date.parse(today)) {
          const up = su.dir === 'up', cl = c[k].c;
          const av = c.slice(k - 32, k).reduce((s2, r) => s2 + r.v, 0) / 32, vx = av ? c[k].v / av : 0;
          if (up ? cl > su.level * 1.003 : cl < su.level * 0.997) {
            su.triggered = true;
            if (!seeding) found.push({ at, sym, kind: 'break', text: triggerText(su, cl, vx), delivered: false });
          }
        }
      }
      const b = breakCheck(sym, m15.bars, now, fromKucoin.has(sym) ? 6.0 : 4.0); // smaller top-list coins swing more: 6% for a fast-move alert
      if (b && !seeding) {
        const prev = state.breaks[sym];
        if (!(prev && prev.dir === b.dir && now - Date.parse(prev.at) < COOLDOWN)) {
          found.push({ at, sym, kind: 'break', text: breakText(b, fromKucoin.has(sym)), delivered: false });
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
  if (setupCards.length && telegramConfigured() && !dry && !seeding) {
    const ups = setupCards.filter(t => t.startsWith('🟢')).length;
    await sendTelegram(`🎯 <b>Crypto setups to watch · ${today}</b>\n${setupCards.length - ups} SHORT watch, ${ups} LONG watch. Heads-ups only: act only if the trigger hits.\n\n` + setupCards.join('\n\n') +
      '\n\n<i>Pattern-based alerts, not advice. No proven edge yet.</i>', { html: true });
  }
  if (found.length && telegramConfigured() && !dry) {
    await sendTelegram(alertMessage(found, now), { html: true }); // throws on failure: state is not saved, so the next run retries
    delivered = true;
  }
  for (const f of found) f.delivered = delivered;

  if (!dry) {
    await store.set(STATE_KEY, {
      last: { ...state.last, ...labels },
      breaks: nextBreaks,
      recent: [...found, ...state.recent].slice(0, 40),
      checked: at,
      setupDay: today,
      setups: setups!,
    } satisfies AlertState);
  }
  return { checkedAt: at, seeded: seeding, dry, coins: coins.length, watching: coins.join(","), topList: skippedTop ? `failed: ${skippedTop}` : extra.length, storage: store.kind, telegram: telegramConfigured(), alerts: found, labels, skipped, bars15, freshBreaks };
}

export async function readState() {
  const store = getStore();
  return { state: (await store.get<AlertState>(STATE_KEY)) ?? emptyState(), storage: store.kind };
}
