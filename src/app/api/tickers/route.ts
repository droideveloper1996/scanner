import { NextResponse } from 'next/server';
import { getTickers } from '@/lib/cryptocom';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ map: await getTickers(), at: Date.now() }, { headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=30' } });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
