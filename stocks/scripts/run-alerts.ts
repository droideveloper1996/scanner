/* Runs the stock alert check once. Used by the GitHub Actions workflow every 5 minutes during NSE hours.
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to send; alert state goes to DATA_DIR (default .data/).
 * Usage: tsx scripts/run-alerts.ts [--dry]   (market-hours gate: set FORCE=1 to run anyway)
 * Alerts only; this never places orders. */
import { runAlerts } from '../src/alerts.ts';

import { sendTelegram, telegramConfigured } from '../src/telegram.ts';
const dry = process.argv.includes('--dry');
if (process.env.SEND_TEST) {
  console.log(`Telegram secrets in use: ${process.env.TG_SOURCE || 'unknown'}; configured: ${telegramConfigured()}`);
  await sendTelegram('<b>Stock alerts · TEST</b>\n\n🚀 <b>SAMPLE</b> · Example Ltd\nbreakout above session high ₹101.87 · volume 2.1x · +1.4% 1h\n<pre>Entry  ₹103.12\nStop   ₹101.36\nT1 +1R ₹104.89  (then stop to entry)\nT2 +2R ₹106.65</pre>\nThis is a sample, not a trade signal. Real alerts start on the next NSE session.');
  console.log('Test message sent.'); process.exit(0);
}
const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
const g = Object.fromEntries(p.map(x => [x.type, x.value])) as Record<string, string>;
const mins = +g.hour * 60 + +g.minute, weekday = !['Sat', 'Sun'].includes(g.weekday);
if (!process.env.FORCE && !(weekday && mins >= 9 * 60 + 20 && mins <= 15 * 60 + 40)) { console.log(`Outside NSE hours (${g.weekday} ${g.hour}:${g.minute} IST): nothing to do.`); process.exit(0); }

runAlerts({ dry }).then(r => {
  console.log(JSON.stringify(r, null, 1));
  if (r.skipped.length === r.stocks) process.exit(1); // every stock failed: make the run red
}).catch(e => { console.error((e as Error).message); process.exit(1); });
