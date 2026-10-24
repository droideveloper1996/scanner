/* Sends ../briefs/stocks.html to the stock bot's chats (owner + subscribers). */
import { readFileSync } from 'fs';
import { sendTelegram } from '../src/telegram.ts';
const html = readFileSync('../briefs/stocks.html', 'utf8').trim();
if (!html) { console.error('empty brief'); process.exit(1); }
sendTelegram(html).then(r => console.log(`brief stocks sent to ${r.sent} chat(s)`)).catch(e => { console.error((e as Error).message); process.exit(1); });
