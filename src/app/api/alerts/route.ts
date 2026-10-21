import { NextResponse } from 'next/server';
import { readState } from '@/lib/alerts';
import { alertCoins } from '@/lib/config';
import { telegramConfigured } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** Read-only feed for the page: recent alerts and whether alerting is set up. */
export async function GET() {
  const base = { telegram: telegramConfigured(), cronSecret: Boolean(process.env.CRON_SECRET), coins: alertCoins() };
  try {
    const { state, storage } = await readState();
    return NextResponse.json({ ...base, storage, checked: state.checked, recent: state.recent.slice(0, 20) });
  } catch (e) {
    return NextResponse.json({ ...base, storage: null, checked: null, recent: [], error: (e as Error).message });
  }
}
