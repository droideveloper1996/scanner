/* Headline news alerts + daily summary for the stock bot (06:30-23:30 IST, any day). NEWS_DAILY=1 forces the summary now. */
import { runNews } from '../src/news.ts';
import { sendTelegram, sendTo, syncSubscribers } from '../src/telegram.ts';
import { loadWatch, newsMatches } from '../src/watch.ts';
const ist = new Date(Date.now() + 5.5 * 3600e3), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
if (!process.env.NEWS_DAILY && (m < 6 * 60 + 30 || m > 23 * 60 + 30)) { console.log('Night: skipped'); process.exit(0); }
await syncSubscribers().catch(e => console.error(`subscribers: ${(e as Error).message}`)); // answers watchlist messages outside market hours too
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
try {
  const r = await runNews('stocks', sendTelegram, { dailyHourIst: 8, forceDaily: !!process.env.NEWS_DAILY });
  const { freshItems, ...rest } = r; console.log(JSON.stringify(rest));
  // headlines that name a stock on someone's personal watchlist go to that person, whatever their keyword score
  if (freshItems.length) {
    const w = await loadWatch();
    for (const [id, syms] of Object.entries(w.users)) {
      const hits = syms.flatMap(s => freshItems.filter(i => newsMatches(s, w.names[s] || s, i.title)).map(i => ({ s, i }))).slice(0, 6);
      if (hits.length) await sendTo(id, `<b>📰 News on your watchlist</b>\n\n` + hits.map(({ s, i }) => `${i.score > 0 ? '🟢' : i.score < 0 ? '🔴' : '⚪'} <b>${esc(s)}</b> · ${i.link ? `<a href="${esc(i.link)}">${esc(i.title)}</a>` : esc(i.title)} <i>(${esc(i.src)})</i>`).join('\n\n') + '\n\n<i>Headline keyword read, not advice.</i>').catch(() => null);
    }
  }
} catch (e) { console.error((e as Error).message); process.exit(1); }
