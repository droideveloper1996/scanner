/** Telegram Bot API sender. The token only ever comes from the environment. Messages are HTML. */
const API = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

import { getStore } from './store.ts';

type Subs = { ids: number[]; offset: number };
const SUBS_KEY = 'stock-telegram-subscribers';
const WELCOME = '✅ Subscribed to stock alerts (NSE signals + breakouts, checked every 5 min in market hours). Not investment advice. Send /stop to unsubscribe.';
const BYE = 'Unsubscribed. Send /start to subscribe again.';

async function tg(method: string, body: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const r = await fetch(`${API()}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: unknown };
  return { ok: r.ok && j.ok !== false, status: r.status, result: j.result }; // never echo the URL: it contains the token
}

/** Any message to the bot subscribes that chat, /stop unsubscribes. Returns the subscriber ids. */
export async function syncSubscribers(): Promise<number[]> {
  const store = getStore();
  const subs = (await store.get<Subs>(SUBS_KEY)) ?? { ids: [], offset: 0 };
  const r = await tg('getUpdates', { offset: subs.offset, timeout: 0, allowed_updates: ['message'] });
  if (!r.ok) return subs.ids;
  const updates = (r.result as { update_id: number; message?: { chat?: { id: number }; text?: string } }[]) || [];
  let changed = false;
  for (const u of updates) {
    subs.offset = Math.max(subs.offset, u.update_id + 1); changed = true;
    const id = u.message?.chat?.id; if (!id) continue;
    const stop = /^\/stop\b/i.test(u.message?.text || '');
    const has = subs.ids.includes(id);
    if (stop && has) { subs.ids = subs.ids.filter(x => x !== id); await tg('sendMessage', { chat_id: id, text: BYE }); }
    else if (!stop && !has) { subs.ids.push(id); await tg('sendMessage', { chat_id: id, text: WELCOME }); }
  }
  if (changed) await store.set(SUBS_KEY, subs);
  return subs.ids;
}

/** Sends to the owner chat and every subscriber. Throws only if the owner chat fails (so the run is retried);
 *  subscribers who blocked the bot are dropped. */
export async function sendTelegram(html: string): Promise<{ sent: number }> {
  const owner = process.env.TELEGRAM_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !owner) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set');
  const subs = await syncSubscribers().catch(() => [] as number[]);
  // split on blank lines so a long batch never exceeds Telegram's 4096-character limit
  const parts: string[] = []; let cur = '';
  for (const block of html.split('\n\n')) {
    if (cur && cur.length + block.length + 2 > 3800) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + block;
  }
  if (cur) parts.push(cur);
  const send = async (chat: string | number) => {
    for (const text of parts) { const x = await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); if (!x.ok) return x; }
    return { ok: true, status: 200 };
  };
  const r = await send(owner);
  if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`);
  let sent = 1; const gone: number[] = [];
  for (const id of subs) {
    if (String(id) === owner.trim()) continue;
    const x = await send(id);
    if (x.ok) sent++; else if (x.status === 403 || x.status === 400) gone.push(id);
  }
  if (gone.length) {
    const store = getStore(); const c = (await store.get<Subs>(SUBS_KEY)) ?? { ids: [], offset: 0 };
    await store.set(SUBS_KEY, { ...c, ids: c.ids.filter(i => !gone.includes(i)) });
  }
  return { sent };
}

/** Chats that have messaged the bot, so you can copy your chat id (run once: tsx scripts/whoami.ts). */
export async function telegramChats() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const r = await fetch(`${API()}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`);
  const j = (await r.json()) as { result?: { message?: { chat?: { id: number; first_name?: string; username?: string } } }[] };
  const seen = new Map<number, { id: number; name?: string; username?: string }>();
  for (const u of j.result || []) { const c = u.message?.chat; if (c) seen.set(c.id, { id: c.id, name: c.first_name, username: c.username }); }
  return [...seen.values()];
}
