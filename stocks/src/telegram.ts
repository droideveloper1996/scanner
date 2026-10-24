/** Telegram Bot API sender. The token only ever comes from the environment. Messages are HTML. */
const API = () => process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export async function sendTelegram(html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set');
  // split on blank lines so a long batch never exceeds Telegram's 4096-character limit
  const parts: string[] = []; let cur = '';
  for (const block of html.split('\n\n')) {
    if (cur && cur.length + block.length + 2 > 3800) { parts.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + block;
  }
  if (cur) parts.push(cur);
  for (const text of parts) {
    const r = await fetch(`${API()}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`); // never echo the URL: it contains the token
  }
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
