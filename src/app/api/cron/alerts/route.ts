import { NextRequest, NextResponse } from 'next/server';
import { runAlerts } from '@/lib/alerts';
import { sendTelegram, telegramChats, telegramConfigured } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Called on a schedule (GitHub Actions, Vercel Cron, cron-job.org). Needs CRON_SECRET.
 *    default      run the checks, send Telegram alerts, save state
 *    ?dry=1       run the checks only, send nothing, save nothing
 *    ?test=1      send a test message to Telegram
 *    ?whoami=1    list chats that messaged the bot (to find TELEGRAM_CHAT_ID) */
async function handler(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 });
  const auth = req.headers.get('authorization') === `Bearer ${secret}` || req.headers.get('x-cron-secret') === secret;
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  try {
    if (q.get('whoami')) return NextResponse.json({ chats: await telegramChats() });
    if (q.get('test')) {
      if (!telegramConfigured()) return NextResponse.json({ error: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first' }, { status: 400 });
      await sendTelegram('✅ Crypto Scanner alerts are connected.');
      return NextResponse.json({ sent: true });
    }
    const { bars15, freshBreaks, ...res } = await runAlerts({ dry: Boolean(q.get('dry')) });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
export { handler as GET, handler as POST };
