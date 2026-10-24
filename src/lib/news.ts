/** Headline news alerts + daily summary. Free RSS feeds, keyword read of each headline (no AI, no tokens).
 *  A bullish/bearish tag here is only a headline keyword count, not analysis or advice. Alerts only; never orders. */
import { getStore } from './store';

export type NewsKind = 'stocks' | 'crypto';
type Item = { id: string; title: string; src: string; link: string; ts: number; score: number };
type State = { seen: Record<string, number>; items: Item[]; lastDaily: string; seeded: boolean };

const FEEDS: Record<NewsKind, string[]> = {
  stocks: [
    'https://news.google.com/rss/search?q=Sensex+OR+Nifty+OR+%22NSE+stocks%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://news.google.com/rss/search?q=India+stocks+results+OR+upgrade+OR+downgrade+OR+FII+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
    'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms',
    'https://www.livemint.com/rss/markets',
    'https://www.moneycontrol.com/rss/marketreports.xml',
  ],
  crypto: [
    'https://news.google.com/rss/search?q=bitcoin+OR+ethereum+OR+crypto+when:1d&hl=en-US&gl=US&ceid=US:en',
    'https://cointelegraph.com/rss',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://decrypt.co/feed',
  ],
};
const BULL: Record<NewsKind, string[]> = {
  stocks: ['surge', 'rally', 'record high', 'all-time high', 'upgrade', 'beats', 'profit jumps', 'profit rises', 'order win', 'bags order', 'buyback', 'dividend', 'bonus', 'fii buying', 'rate cut', 'strong results', 'gains', 'jumps', 'soars', 'breakout', 'outperform', 'top pick', 'bullish', 'rebound'],
  crypto: ['surge', 'rally', 'etf inflow', 'inflows', 'approval', 'approves', 'adoption', 'all-time high', 'record high', 'partnership', 'upgrade', 'accumulat', 'soars', 'jumps', 'breakout', 'bullish', 'rebound', 'rate cut'],
};
const BEAR: Record<NewsKind, string[]> = {
  stocks: ['plunge', 'crash', 'falls', 'tumbles', 'downgrade', 'misses', 'loss widens', 'net loss', 'probe', 'fraud', 'penalty', 'sebi order', 'fii selling', 'rate hike', 'slump', 'sell-off', 'selloff', 'tariff', 'war', 'default', 'resigns', 'bearish', 'slides', 'drops', 'weak results'],
  crypto: ['hack', 'exploit', 'crash', 'plunge', 'liquidat', 'ban', 'lawsuit', 'sues', 'outflow', 'dump', 'delist', 'rug pull', 'depeg', 'fraud', 'bankrupt', 'bearish', 'slump', 'sell-off', 'selloff', 'tumbles', 'rate hike', 'drops'],
};
const ent = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (b: string, t: string) => ent((b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');
const ist = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(11, 16) + ' IST';
const istDay = (t: number) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

export function scoreTitle(kind: NewsKind, title: string) {
  const t = title.toLowerCase();
  const hit = (w: string) => (w.length <= 4 ? new RegExp(`\\b${w}\\b`).test(t) : t.includes(w));
  return BULL[kind].filter(hit).length - BEAR[kind].filter(hit).length;
}

async function fetchFeed(url: string, kind: NewsKind, now: number): Promise<Item[] | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (news-alerts)' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const xml = await r.text();
    const out: Item[] = [];
    for (const b of xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []) {
      let title = tag(b, 'title'); const link = tag(b, 'link') || tag(b, 'guid');
      const ts = Date.parse(tag(b, 'pubDate')) || now;
      let src = tag(b, 'source');
      const m = title.match(/^(.*) - ([^-]{2,40})$/); if (m) { title = m[1]; src = src || m[2]; }
      if (!title || now - ts > 36 * 3600e3) continue;
      out.push({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 90), title, src: src || new URL(url).hostname.replace(/^www\./, ''), link, ts, score: scoreTitle(kind, title) });
    }
    return out;
  } catch { return null; }
}

const line = (i: Item) => `${i.score > 0 ? '🟢' : i.score < 0 ? '🔴' : '⚪'} ${i.link ? `<a href="${esc(i.link)}">${esc(i.title)}</a>` : esc(i.title)} <i>(${esc(i.src)})</i>`;

export async function runNews(kind: NewsKind, send: (html: string) => Promise<unknown>, opts: { dailyHourIst?: number; forceDaily?: boolean } = {}) {
  const now = Date.now(), store = getStore(), key = `news-state-${kind}`;
  const st = (await store.get<State>(key)) ?? { seen: {}, items: [], lastDaily: '', seeded: false };
  const res = await Promise.all(FEEDS[kind].map(u => fetchFeed(u, kind, now)));
  const ok = res.filter(Boolean).length;
  console.log(`${kind}: ${ok}/${FEEDS[kind].length} feeds reachable`);
  const fresh: Item[] = [];
  for (const it of res.flat().filter((x): x is Item => !!x)) {
    if (st.seen[it.id]) continue;
    st.seen[it.id] = now; fresh.push(it); st.items.push(it);
  }
  st.items = st.items.filter(i => now - i.ts < 36 * 3600e3);
  for (const k of Object.keys(st.seen)) if (now - st.seen[k] > 48 * 3600e3) delete st.seen[k];
  const label = kind === 'stocks' ? 'Stock news' : 'Crypto news';
  let sentAny = false;
  if (st.seeded && fresh.length) {
    const hot = fresh.filter(i => i.score !== 0 && now - i.ts < 6 * 3600e3).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 6);
    if (hot.length) { await send(`<b>${label} · ${ist(now)}</b>\n\n` + hot.map(line).join('\n\n') + '\n\n<i>🟢/🔴 = headline keyword read, not advice.</i>'); sentAny = true; }
  }
  // daily summary: once a day after dailyHourIst (IST) on a day it has not been sent
  const today = istDay(now), hour = +new Date(now + 5.5 * 3600e3).toISOString().slice(11, 13);
  if (st.seeded && (opts.forceDaily || (opts.dailyHourIst !== undefined && hour >= opts.dailyHourIst && st.lastDaily !== today)) && st.items.length) {
    const recent = st.items.filter(i => now - i.ts < 24 * 3600e3);
    const bull = recent.filter(i => i.score > 0), bear = recent.filter(i => i.score < 0);
    const top = (a: Item[]) => [...a].sort((x, y) => Math.abs(y.score) - Math.abs(x.score) || y.ts - x.ts).slice(0, 4);
    const tilt = bull.length > bear.length * 1.3 ? 'leaning bullish' : bear.length > bull.length * 1.3 ? 'leaning bearish' : 'mixed';
    await send(`<b>${label} · daily summary · ${today}</b>\n${recent.length} headlines in 24h: 🟢 ${bull.length} bullish, 🔴 ${bear.length} bearish, ${recent.length - bull.length - bear.length} neutral. Headline tone: <b>${tilt}</b>.\n\n` +
      `<b>What looks bullish</b>\n${top(bull).map(line).join('\n') || 'None found'}\n\n<b>What looks bearish</b>\n${top(bear).map(line).join('\n') || 'None found'}\n\n<i>Keyword read of headlines, not analysis or advice.</i>`);
    st.lastDaily = today; sentAny = true;
  }
  if (ok > 0) st.seeded = true; // first successful run only records what exists, so it never dumps old headlines
  await store.set(key, st);
  return { feedsOk: ok, fresh: fresh.length, sent: sentAny };
}
