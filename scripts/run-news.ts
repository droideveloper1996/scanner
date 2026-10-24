/* Headline news alerts + daily summary for the crypto bot. Usage: tsx scripts/run-news.ts  (NEWS_DAILY=1 forces the summary now) */
import { runNews } from '../src/lib/news';
import { sendTelegram, syncSubscribers } from '../src/lib/telegram';
async function main() {
  await syncSubscribers().catch(() => []);
  const r = await runNews('crypto', t => sendTelegram(t, { html: true }), { dailyHourIst: 8, forceDaily: !!process.env.NEWS_DAILY });
  console.log(JSON.stringify(r));
}
main().catch(e => { console.error((e as Error).message); process.exit(1); });
