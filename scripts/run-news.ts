/* Headline news alerts + daily summary for the crypto bot. Usage: tsx scripts/run-news.ts  (NEWS_DAILY=1 forces the summary now) */
import { runNews } from '../src/lib/news';
import { sendTelegram, syncSubscribers } from '../src/lib/telegram';
await syncSubscribers().catch(() => []);
runNews('crypto', t => sendTelegram(t, { html: true }), { dailyHourIst: 8, forceDaily: !!process.env.NEWS_DAILY }).then(r => console.log(JSON.stringify(r))).catch(e => { console.error((e as Error).message); process.exit(1); });
