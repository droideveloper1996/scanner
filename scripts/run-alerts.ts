/* Runs the alert check once, without the Next.js server. Used by the GitHub Actions workflow every 15 minutes.
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to send; alert state goes to DATA_DIR (default .data/).
 * Also steps the virtual pump book in paper/pump-book.json (PUMP_BOOK to override). No real orders.
 * Usage: tsx scripts/run-alerts.ts [--dry] [--test]   (--test only sends a Telegram test message) */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { runAlerts } from '../src/lib/alerts';
import { newBook, stepBook, type PumpBook } from '../src/lib/pumpbook';
import { sendTelegram, syncSubscribers, telegramConfigured } from '../src/lib/telegram';

const dry = process.argv.includes('--dry');
const bookPath = process.env.PUMP_BOOK || path.join('paper', 'pump-book.json');

async function main() {
  if (process.argv.includes('--test')) {
    if (!telegramConfigured()) throw new Error('Telegram secrets missing');
    const { sent } = await sendTelegram(`✅ Test from crypto scanner (GitHub Actions) at ${new Date().toISOString()}. Alerts are live, scanning every 5 min.`);
    console.log('test message sent to', sent, 'chat(s)'); // counts only: logs are public
    return;
  }
  if (telegramConfigured()) console.log('subscribers:', (await syncSubscribers().catch(() => [])).length);
  const r = await runAlerts({ dry });
  const { bars15, freshBreaks, labels, ...rest } = r;
  console.log(JSON.stringify(rest, null, 1));
  if (r.skipped.length === r.coins) process.exit(1); // every coin failed: make the run red
  if (r.seeded) return;

  const book: PumpBook = existsSync(bookPath) ? JSON.parse(readFileSync(bookPath, 'utf8')) : newBook();
  const msgs = stepBook(book, bars15, freshBreaks, Date.now());
  if (msgs.length) console.log(msgs.join('\n'));
  if (dry || (!msgs.length && existsSync(bookPath))) return;
  if (msgs.length && telegramConfigured()) await sendTelegram(msgs.join('\n'));
  mkdirSync(path.dirname(bookPath), { recursive: true });
  writeFileSync(bookPath, JSON.stringify(book, null, 1));
}
main().catch(e => { console.error((e as Error).message); process.exit(1); });
