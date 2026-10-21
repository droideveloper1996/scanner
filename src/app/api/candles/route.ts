import { NextRequest, NextResponse } from 'next/server';
import { getCandlesFor, UpstreamError } from '@/lib/cryptocom';
import { tfDef } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sym = (q.get('sym') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const tf = tfDef(q.get('tf') || '1h');
  const count = Math.min(300, Math.max(40, Number(q.get('count')) || 120));
  if (!sym) return NextResponse.json({ error: 'sym required' }, { status: 400 });
  try {
    const { inst, bars } = await getCandlesFor(sym, tf.id, count);
    return NextResponse.json({ inst, bars, at: Date.now() }, { headers: { 'Cache-Control': 's-maxage=20, stale-while-revalidate=40' } });
  } catch (e) {
    const notListed = e instanceof UpstreamError && e.code === 'not_listed';
    return NextResponse.json({ error: notListed ? 'not_listed' : 'unavailable' }, { status: notListed ? 404 : 502 });
  }
}
