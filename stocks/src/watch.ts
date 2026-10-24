/** Personal stock watchlists ("subscribe to a stock"). Anyone can message the bot a stock name or symbol and get a
 *  rules-based advisory card for it, then a pre-market digest of their own list every trading day, plus the intraday
 *  break / strong-signal alerts for names outside the shared universe. Research output only, never orders or advice.
 *
 *  Commands: plain text or /watch <name>, /unwatch <name>, /list, /check <name>, /help. */
import type { Bar } from './types.ts';
import { ema, rsi, trueRange, wilder } from './indicators.ts';
import { getBars, UpstreamError } from './yahoo.ts';
import { NAMES, INDEXES } from './universe.ts';
import { getStore } from './store.ts';
import { setupCheck } from './setups.ts';

export type WatchState = {
  users: Record<string, string[]>;            // chat id -> symbols
  names: Record<string, string>;              // symbol -> company name (from the universe or Yahoo search)
  stance: Record<string, string>;             // symbol -> stance at the last digest, to flag changes
  digestDay?: string;
};
export const WATCH_KEY = 'stock-watch';
export const MAX_PER_USER = 10, MAX_EXTRA = 40;   // EXTRA = watched names outside the shared universe (scanned every 5 min)
const empty = (): WatchState => ({ users: {}, names: {}, stance: {} });
export const loadWatch = async () => ({ ...empty(), ...((await getStore().get<WatchState>(WATCH_KEY)) ?? {}) });
export const saveWatch = (w: WatchState) => getStore().set(WATCH_KEY, w);
export const watchedSyms = (w: WatchState) => [...new Set(Object.values(w.users).flat())];

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const fmt = (x: number) => x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const istDay = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (a / b - 1) * 100;
const sgn = (x: number, d = 1) => `${x > 0 ? '+' : ''}${x.toFixed(d)}`;

/* ---------- symbol lookup ---------- */
const YBASE = () => process.env.YAHOO_API_BASE || 'https://query1.finance.yahoo.com';
const clean = (q: string) => q.trim().replace(/^NSE:/i, '').replace(/\.NS$/i, '').replace(/\s+/g, ' ');

/** Finds an NSE symbol from a symbol or a company name. Universe first, then Yahoo search, then the raw symbol. */
export async function resolveSymbol(q: string): Promise<{ sym: string; name: string } | null> {
  const s = clean(q), up = s.toUpperCase();
  if (!s || s.length > 40) return null;
  if (NAMES[up] && !INDEXES.has(up)) return { sym: up, name: NAMES[up] };
  const low = s.toLowerCase();
  const byName = Object.entries(NAMES).find(([k, n]) => !INDEXES.has(k) && n.toLowerCase() === low)
    ?? Object.entries(NAMES).find(([k, n]) => !INDEXES.has(k) && n.toLowerCase().startsWith(low) && low.length >= 4);
  if (byName) return { sym: byName[0], name: byName[1] };
  try {
    const r = await fetch(`${YBASE()}/v1/finance/search?q=${encodeURIComponent(s)}&quotesCount=10&newsCount=0`, { headers: { 'user-agent': 'Mozilla/5.0 (scanner)' }, signal: AbortSignal.timeout(12000) });
    if (r.ok) {
      const j = (await r.json()) as { quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string }[] };
      const hit = (j.quotes || []).find(x => x.symbol?.endsWith('.NS') && (!x.quoteType || x.quoteType === 'EQUITY'));
      if (hit?.symbol) return { sym: hit.symbol.slice(0, -3).toUpperCase(), name: hit.longname || hit.shortname || hit.symbol };
    }
  } catch { /* search is best effort */ }
  if (/^[A-Z0-9&-]{2,20}$/.test(up)) {
    try { const b = await getBars(up, '1d', '5d'); if (b.length) return { sym: up, name: up }; } catch { /* not listed */ }
  }
  return null;
}

/* ---------- the advisory ---------- */
type NewsItem = { title: string; link: string; src: string; ts: number; score: number };
const STOP = new Set(['india', 'indian', 'bharat', 'bharti', 'state', 'bank', 'power', 'energy', 'national', 'hindustan', 'tata', 'adani', 'bajaj', 'the', 'industries', 'limited', 'ltd', 'company', 'corporation', 'jio', 'union', 'canara', 'punjab']);
/** Headline matches a stock: its symbol in capitals as a word (4+ letters, or a known short ticker), or its name without Ltd/Limited. */
export function newsMatches(sym: string, name: string, title: string) {
  const base = name.replace(/\b(ltd|limited|corporation|corp|company|co)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
  if (base.length >= 4 && base.toUpperCase() !== sym && title.toLowerCase().includes(base.toLowerCase())) return true;
  if ((sym.length >= 4 || ['ITC', 'TCS', 'HAL', 'BEL', 'SBI', 'PNB', 'IOC', 'NHPC', 'IEX'].includes(sym)) && new RegExp(`\\b${sym.replace(/[&]/g, '\\&')}\\b`).test(title)) return true;
  const first = base.split(' ')[0]?.toLowerCase() || '';
  return first.length >= 6 && !STOP.has(first) && new RegExp(`\\b${first}\\b`, 'i').test(title);
}
async function newsFor(sym: string, name: string, now: number): Promise<NewsItem[]> {
  const st = await getStore().get<{ items?: NewsItem[] }>('news-state-stocks').catch(() => null);
  return (st?.items || []).filter(i => now - i.ts < 36 * 3600e3 && newsMatches(sym, name, i.title)).sort((a, b) => b.ts - a.ts).slice(0, 3);
}

/** Daily bars with today's unfinished candle dropped during market hours. */
function closedDaily(d: Bar[], now: number) {
  const last = d[d.length - 1];
  if (!last) return d;
  const end = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 10, 5);
  return istDay(last.t) === istDay(now) && now < end ? d.slice(0, -1) : d;
}

export type Advice = { sym: string; name: string; close: number; stance: string; score: number; card: string; line: string };

export async function advise(sym: string, name: string, now = Date.now(), nifty?: Bar[] | null): Promise<Advice> {
  const daily = closedDaily(await getBars(sym, '1d', '2y'), now);
  if (daily.length < 60) throw new UpstreamError('not_listed', 'less than 60 days of history');
  const idx = nifty !== undefined ? nifty : await getBars('NIFTY', '1d', '1y').then(d => closedDaily(d, now)).catch(() => null);
  const C = daily.map(b => b.c), H = daily.map(b => b.h), L = daily.map(b => b.l), n = C.length - 1, close = C[n];
  const e20 = ema(C, 20)[n]!, e50 = ema(C, 50)[n]!, e200 = C.length >= 200 ? ema(C, 200)[n] : null;
  const R = rsi(C)[n] ?? 50, atr = wilder(trueRange(H, L, C), 14)[n] ?? close * 0.02;
  const y = daily.slice(-250), hi52 = Math.max(...y.map(b => b.h)), lo52 = Math.min(...y.map(b => b.l));
  const m = daily.slice(-21, -1), hi20 = Math.max(...m.map(b => b.h)), lo20 = Math.min(...m.map(b => b.l));
  const chg = pct(close, C[n - 1]);
  let rs: number | null = null;
  if (idx && idx.length > 21 && n > 20) rs = pct(close, C[n - 20]) - pct(idx[idx.length - 1].c, idx[idx.length - 21].c);
  const P = (H[n] + L[n] + C[n]) / 3, R1 = 2 * P - L[n], S1 = 2 * P - H[n];
  const news = await newsFor(sym, name, now);
  const newsScore = news.reduce((s, i) => s + i.score, 0);

  // five votes, +1 / -1 each
  const votes: [number, string][] = [];
  if (e200 != null) votes.push(close > e200 ? [1, `above 200-day avg ₹${fmt(e200)}`] : [-1, `below 200-day avg ₹${fmt(e200)}`]);
  if (close > e20 && e20 > e50) votes.push([1, '20-day avg above 50-day, price above both']);
  else if (close < e20 && e20 < e50) votes.push([-1, '20-day avg below 50-day, price below both']);
  else votes.push([0, 'short-term averages mixed']);
  if (rs != null) votes.push(rs > 3 ? [1, `beat Nifty by ${rs.toFixed(1)}% in 20 days`] : rs < -3 ? [-1, `lagged Nifty by ${(-rs).toFixed(1)}% in 20 days`] : [0, `in line with Nifty (${sgn(rs)}% in 20 days)`]);
  try {
    const h1 = await getBars(sym, '60m', '60d');
    const { strongCheck } = await import('./alerts.ts');
    const s = strongCheck(sym, h1, now);
    if (s) votes.push([s.label.includes('Buy') ? 1 : s.label.includes('Sell') ? -1 : 0, `1h signal ${s.label}`]);
  } catch { /* 1h is optional */ }
  if (news.length) votes.push([newsScore > 0 ? 1 : newsScore < 0 ? -1 : 0, `${news.length} headline(s) in 36h, tone ${newsScore > 0 ? 'positive' : newsScore < 0 ? 'negative' : 'neutral'}`]);
  const score = votes.reduce((s, v) => s + v[0], 0);
  const stance = score >= 3 ? 'Bullish' : score >= 1 ? 'Leaning bullish' : score <= -3 ? 'Bearish' : score <= -1 ? 'Leaning bearish' : 'Neutral';
  const icon = score >= 3 ? '🟢' : score >= 1 ? '🟩' : score <= -3 ? '🔴' : score <= -1 ? '🟥' : '⚪';

  // what the rules say to do (not advice)
  const stop = Math.min(e50, close - 2 * atr);
  let plan: string;
  if (score >= 1) {
    if (R >= 70 || close - e20 > 3 * atr) plan = `Stretched (RSI ${R.toFixed(0)}, ${((close - e20) / atr).toFixed(1)} ATR above the 20-day avg). Wait for a pullback toward ₹${fmt(e20)} before adding.`;
    else if (close - e20 <= atr) plan = `Near the 20-day avg: a buy zone by trend rules. Stop below ₹${fmt(stop)} (${pct(stop, close).toFixed(1)}%).`;
    else plan = `Uptrend. Better entries come near ₹${fmt(e20)} (20-day avg), or on a close above ₹${fmt(hi20)} (20-day high). Stop below ₹${fmt(stop)}.`;
  } else if (score <= -1) plan = `Avoid fresh buying. Holders: the trend turns back up only above ₹${fmt(Math.max(e50, hi20))}; ` +
    (close < lo20 ? `price is already under the 20-day low ₹${fmt(lo20)}, so the downtrend is in force.` : `a close below ₹${fmt(lo20)} (20-day low) opens more downside.`);
  else plan = `No edge either way. Watch for a close above ₹${fmt(hi20)} (20-day high) or below ₹${fmt(lo20)} (20-day low).`;
  const su = setupCheck(sym, daily, idx);
  const setupLine = su ? `\n🎯 ${su.dir === 'up' ? 'CALL' : 'PUT'} watch ${su.points}/6: trigger on a close ${su.dir === 'up' ? 'above' : 'below'} ₹${fmt(su.level)} (${su.dist.toFixed(1)}% away).` : '';

  const nm = name && name !== sym ? ' · ' + esc(name) : '';
  const card = `📌 <b><a href="https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym.replace('&', '_'))}">${esc(sym)}</a></b>${nm}\n` +
    `₹${fmt(close)} (${sgn(chg)}% last session) · 52w ₹${fmt(lo52)}–₹${fmt(hi52)}, ${pct(close, hi52).toFixed(1)}% from the high\n` +
    `${icon} <b>${stance}</b> (${sgn(score, 0)} of ${votes.length}) · RSI ${R.toFixed(0)}\n` +
    votes.map(v => `${v[0] > 0 ? '＋' : v[0] < 0 ? '－' : '·'} ${esc(v[1])}`).join('\n') + '\n' +
    `<pre>Resist   ₹${fmt(hi20)} 20d high · ₹${fmt(R1)} R1\nSupport  ₹${fmt(lo20)} 20d low · ₹${fmt(S1)} S1\n50d avg  ₹${fmt(e50)} · ATR ₹${fmt(atr)}</pre>\n` +
    `<b>Plan:</b> ${esc(plan)}${setupLine}` +
    (news.length ? '\n' + news.map(i => `${i.score > 0 ? '🟢' : i.score < 0 ? '🔴' : '⚪'} <a href="${esc(i.link)}">${esc(i.title)}</a> <i>(${esc(i.src)})</i>`).join('\n') : '');
  const line = `${icon} <b>${esc(sym)}</b> ₹${fmt(close)} (${sgn(chg)}%) · ${stance}`;
  return { sym, name, close, stance, score, card, line };
}

/* ---------- commands ---------- */
export const HELP = '<b>Stock watchlist</b>\nSend a stock name or symbol (e.g. <code>Tata Motors</code> or <code>SWIGGY</code>) to subscribe to it. You get a research card now, a pre-market update for your list each trading day, and breakout / strong-signal alerts on it.\n\n' +
  '/watch NAME · add (same as just typing it)\n/unwatch NAME · remove\n/list · your stocks with today\'s stance\n/check NAME · one card without subscribing\n/stop · stop all messages\n\n' +
  `Up to ${MAX_PER_USER} stocks each. The bot reads messages every 5-10 minutes, so replies are not instant. Rules-based research from public price data and headlines, not investment advice.`;
const NOISE = /^(hi|hello|hey|hii+|ok|okay|thanks|thank you|thx|start|yes|no|test|👍)$/i;

/** Handles one incoming message. send(chatId, html). Returns true if it was a watchlist command. */
export async function handleMessage(chat: number, text: string, send: (chat: number, html: string) => Promise<unknown>): Promise<boolean> {
  const t = text.trim();
  const m = t.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  const cmd = m ? m[1].toLowerCase() : 'watch', arg = m ? m[2].trim() : t;
  if (m && !['watch', 'add', 'sub', 'subscribe', 'unwatch', 'remove', 'del', 'list', 'my', 'mylist', 'check', 'advice', 'help'].includes(cmd)) return false;
  if (!m && (NOISE.test(t) || t.length < 2)) return false;
  const id = String(chat);

  if (cmd === 'help') { await send(chat, HELP); return true; }

  if (cmd === 'list' || cmd === 'my' || cmd === 'mylist') {
    const w = await loadWatch(), mine = w.users[id] || [];
    if (!mine.length) { await send(chat, 'Your watchlist is empty. Send a stock name to add one.'); return true; }
    const now = Date.now(), nifty = await getBars('NIFTY', '1d', '1y').then(d => closedDaily(d, now)).catch(() => null);
    const lines: string[] = [];
    for (const s of mine) { try { lines.push((await advise(s, w.names[s] || s, now, nifty)).line); } catch { lines.push(`⚠️ <b>${esc(s)}</b> · no data right now`); } }
    await send(chat, `<b>Your watchlist (${mine.length}/${MAX_PER_USER})</b>\n${lines.join('\n')}\n\n<i>/check NAME for the full card. Not advice.</i>`);
    return true;
  }

  const items = arg.split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 5);
  if (!items.length) { await send(chat, `Add a stock name, e.g. <code>/${cmd} Tata Motors</code>.`); return true; }

  if (cmd === 'unwatch' || cmd === 'remove' || cmd === 'del') {
    const w = await loadWatch(), mine = w.users[id] || [];
    const gone: string[] = [];
    for (const q of items) {
      const up = clean(q).toUpperCase();
      const s = mine.find(x => x === up) ?? mine.find(x => (w.names[x] || '').toLowerCase().startsWith(clean(q).toLowerCase()));
      if (s) gone.push(s);
    }
    w.users[id] = mine.filter(x => !gone.includes(x));
    if (!w.users[id].length) delete w.users[id];
    await saveWatch(w);
    await send(chat, gone.length ? `Removed ${gone.map(esc).join(', ')}. ${w.users[id]?.length ?? 0} left.` : `Not on your list: ${items.map(esc).join(', ')}. Send /list to see it.`);
    return true;
  }

  // watch (default for plain text) or check
  const subscribe = cmd !== 'check' && cmd !== 'advice';
  const now = Date.now();
  for (const q of items) {
    const hit = await resolveSymbol(q);
    if (!hit) { await send(chat, `Couldn't find "${esc(q)}" on NSE. Try the NSE symbol (e.g. TATAMOTORS) or the full company name.`); continue; }
    const w = await loadWatch(), mine = w.users[id] || [];
    let note = '';
    if (subscribe) {
      const { watchList } = await import('./universe.ts');
      const extra = watchedSyms(w).filter(s => !watchList().includes(s));
      if (mine.includes(hit.sym)) note = 'Already on your watchlist.';
      else if (mine.length >= MAX_PER_USER) note = `Your list is full (${MAX_PER_USER}). /unwatch one first. Showing the card only.`;
      else if (!watchList().includes(hit.sym) && !extra.includes(hit.sym) && extra.length >= MAX_EXTRA) note = 'The bot is at its scanning limit, so this one gets the daily update but no intraday alerts.';
      if (!mine.includes(hit.sym) && mine.length < MAX_PER_USER) {
        w.users[id] = [...mine, hit.sym]; w.names[hit.sym] = hit.name; await saveWatch(w);
        note = (note ? note + ' ' : '') + `✅ Subscribed (${w.users[id].length}/${MAX_PER_USER}). You'll get a pre-market update each trading day and alerts on breaks. /unwatch ${hit.sym} to stop.`;
      }
    }
    try {
      const a = await advise(hit.sym, hit.name, now);
      await send(chat, `${a.card}${note ? '\n\n' + note : ''}\n\n<i>Rules-based read of public prices and headlines, not investment advice.</i>`);
    } catch (e) {
      await send(chat, `${esc(hit.sym)}: price data is not available right now (${esc((e as Error).message)}).${note ? '\n' + note : ''}`);
    }
  }
  return true;
}

/* ---------- daily digest ---------- */
/** Once per IST day: each subscriber gets their own list (full card when the stance changed, one line otherwise). */
export async function sendDigests(send: (chat: number, html: string) => Promise<{ ok: boolean; status: number }>, now = Date.now(), force = false) {
  const w = await loadWatch(), today = istDay(now);
  if (!Object.keys(w.users).length || (!force && w.digestDay === today)) return { users: 0 };
  const nifty = await getBars('NIFTY', '1d', '1y').then(d => closedDaily(d, now)).catch(() => null);
  const adv: Record<string, Advice | null> = {};
  for (const s of watchedSyms(w)) { try { adv[s] = await advise(s, w.names[s] || s, now, nifty); } catch { adv[s] = null; } }
  let users = 0;
  for (const [id, syms] of Object.entries(w.users)) {
    const parts: string[] = [];
    for (const s of syms) {
      const a = adv[s];
      if (!a) { parts.push(`⚠️ <b>${esc(s)}</b> · no data`); continue; }
      const prev = w.stance[s];
      parts.push(prev && prev !== a.stance ? `🔔 <b>Stance changed: ${esc(prev)} → ${esc(a.stance)}</b>\n${a.card}` : syms.length <= 3 ? a.card : a.line);
    }
    const r = await send(+id, `<b>☀️ Your watchlist · ${today}</b>\n\n${parts.join('\n\n')}\n\n<i>/check NAME for a full card. Rules-based research, not advice.</i>`);
    if (!r.ok && (r.status === 403 || r.status === 400)) delete w.users[id]; else users++;
  }
  for (const [s, a] of Object.entries(adv)) if (a) w.stance[s] = a.stance;
  w.digestDay = today;
  await saveWatch(w);
  return { users };
}
