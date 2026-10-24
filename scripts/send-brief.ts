/* Sends briefs/<name>.html to the Telegram chats of one bot (owner + subscribers). Usage: tsx scripts/send-brief.ts crypto */
import { readFileSync } from 'fs';
import { sendTelegram, syncSubscribers } from '../src/lib/telegram';
async function main() {
  const name = process.argv[2] || 'crypto';
  const html = readFileSync(`briefs/${name}.html`, 'utf8').trim();
  if (!html) throw new Error('empty brief');
  await syncSubscribers().catch(() => []);
  const r = await sendTelegram(html, { html: true });
  console.log(`brief ${name} sent to ${r.sent} chat(s)`);
}
main().catch(e => { console.error((e as Error).message); process.exit(1); });
