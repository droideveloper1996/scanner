/* Headline news alerts + daily summary for the stock bot (06:30-23:30 IST, any day). NEWS_DAILY=1 forces the summary now. */
import { runNews } from '../src/news.ts';
import { sendTelegram } from '../src/telegram.ts';
const ist = new Date(Date.now() + 5.5 * 3600e3), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
if (!process.env.NEWS_DAILY && (m < 6 * 60 + 30 || m > 23 * 60 + 30)) { console.log('Night: skipped'); process.exit(0); }
runNews('stocks', sendTelegram, { dailyHourIst: 8, forceDaily: !!process.env.NEWS_DAILY }).then(r => console.log(JSON.stringify(r))).catch(e => { console.error((e as Error).message); process.exit(1); });
