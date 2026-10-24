/* Computes the daily setups from the last closed session and sends them as a watchlist for the next session.
 * Does not touch alert state, so Monday's pre-market run still sends its own list. Usage: tsx scripts/send-setups.ts [label] */
import { getBars } from '../src/yahoo.ts';
import { watchList } from '../src/universe.ts';
import { setupCheck, type Setup } from '../src/setups.ts';
import { closedDaily, setupText } from '../src/alerts.ts';
import { sendTelegram } from '../src/telegram.ts';

const now = Date.now(), label = process.argv[2] || 'next session';
const nifty = closedDaily(await getBars('NIFTY', '1d', '1y'), now);
const got: Setup[] = [];
for (const sym of watchList()) {
  try { const x = setupCheck(sym, closedDaily(await getBars(sym, '1d', '1y'), now), nifty); if (x) got.push(x); } catch { /* skip */ }
}
got.sort((a, b) => b.points - a.points || a.dist - b.dist);
const top = got.slice(0, 8);
const n = nifty.length - 1, nchg = ((nifty[n].c / nifty[n - 1].c - 1) * 100).toFixed(2);
console.log(`${got.length} setups: ${got.map(x => `${x.dir === 'up' ? 'CALL' : 'PUT'} ${x.sym} ${x.points}/6`).join(', ')}`);
const ups = top.filter(x => x.dir === 'up').length;
await sendTelegram(`<b>🎯 Watchlist for ${label}</b>\nFrom the last close (Nifty ${nifty[n].c.toFixed(0)}, ${+nchg > 0 ? '+' : ''}${nchg}% on the day). ${top.length - ups} PUT watch, ${ups} CALL watch.\n` +
  `Nothing here is a buy now: wait for the 15m trigger. The bot sends a trigger alert if it hits.\n\n` + (top.length ? top.map(x => setupText(x, now)).join('\n\n') : 'No stock is close to a clean setup right now. Cash is a position.') +
  '\n\n<i>Pattern-based watchlist, not advice. Replay: about half of triggered setups were in profit after 3 days. Options can lose the full premium.</i>');
console.log('sent');
