/* Pump sleeve of the $1,200 crypto paper book: paper-trades the 15m breakouts from the alert check. No real orders, ever.
 * The sleeve has its own cash (PUMP_SLEEVE, default $300) so it can't starve the 4h trend rules; paper-crypto/pump_sync.py
 * merges this file into paper-crypto/state.json on the 4-hourly run.
 * Rules (book rules_v 2, 11 Oct 2026):
 *   entry   a fresh upside 15m breakout alert (8h high broken on >=1.5x volume), long only, one position per coin
 *   price   the closing price of the breakout check (the latest closed 15m candle)
 *   stop    0.5% under the broken 8h high; moves to entry (breakeven) once price reaches +1R;  target 2R;  time stop 24h
 *   size    up to $150 per position, risk <= $18 (1.5% of the $1,200 book), max 2 open; 0.1% fee per side
 * Exits are checked on 15m candles after the entry candle; for the candle still forming only its latest price counts,
 * so a run every 5 minutes reacts to fast moves. If a candle touches both stop and target, the stop counts. */
import type { Bar } from './types';
import { fmt } from './alerts';

export type Pos = { sym: string; entry: number; qty: number; stop: number; target: number; at: string; level: number; from: number; risk?: number }; // from: first candle open time that counts for exits
export type Closed = Pos & { exit: number; exitAt: string; why: 'stop' | 'target' | 'time'; pnl: number };
export type PumpBook = { rules_v: number; start: number; cash: number; open: Pos[]; closed: Closed[]; updated: string | null };
const SLEEVE = Number(process.env.PUMP_SLEEVE) || 300;
export const newBook = (): PumpBook => ({ rules_v: 2, start: SLEEVE, cash: SLEEVE, open: [], closed: [], updated: null });

const FEE = 0.001, SLOT = 150, RISK_USD = 18, MAX_OPEN = 2, STOP_BELOW = 0.005, R_MULT = 2, MAX_HOLD = 24 * 3600e3;

export type Break = { sym: string; dir: 'up' | 'down'; kind: string; level: number | null; close: number };

export function equity(b: PumpBook, last: Record<string, number>) {
  return b.cash + b.open.reduce((s, p) => s + p.qty * (last[p.sym] ?? p.entry), 0);
}

/** Applies exits, then entries. Returns Telegram lines for what happened. Mutates the book. */
export function stepBook(b: PumpBook, bars15: Record<string, Bar[]>, breaks: Break[], now: number): string[] {
  const msgs: string[] = [], at = new Date(now).toISOString();
  const last: Record<string, number> = {};
  for (const [s, c] of Object.entries(bars15)) if (c.length) last[s] = c[c.length - 1].c;
  const closedT: Record<string, number> = {};   // open time of the newest closed candle per coin
  for (const [s, c] of Object.entries(bars15)) {
    const k = c.filter(r => now - r.t >= 15 * 60e3); if (k.length) closedT[s] = k[k.length - 1].t;
  }

  for (const p of [...b.open]) {
    const c = (bars15[p.sym] || []).filter(r => r.t >= p.from)              // candles after the entry candle;
      .map(r => (now - r.t < 15 * 60e3 ? { ...r, o: r.c, h: r.c, l: r.c } : r)); // forming one: latest price only
    const risk = p.risk ?? p.entry - p.stop;
    let exit: number | null = null, why: Closed['why'] | null = null, exitAt = at;
    for (const r of c) {
      if (r.l <= p.stop) { exit = Math.min(p.stop, r.o); why = 'stop'; exitAt = new Date(r.t).toISOString(); break; }
      if (r.h >= p.target) { exit = Math.max(p.target, r.o); why = 'target'; exitAt = new Date(r.t).toISOString(); break; }
      if (r.h >= p.entry + risk && p.stop < p.entry) { p.risk = risk; p.stop = p.entry; msgs.push(`📒 PAPER pump ${p.sym} hit +1R, stop moved to entry $${fmt(p.entry)}`); }
    }
    p.from = Math.max(p.from, closedT[p.sym] ?? p.from);   // next run re-reads the newest closed candle onward
    if (!why && now - Date.parse(p.at) >= MAX_HOLD && last[p.sym] != null) { exit = last[p.sym]; why = 'time'; }
    if (!why || exit == null) continue;
    const gross = p.qty * exit, pnl = gross * (1 - FEE) - p.qty * p.entry * (1 + FEE);
    b.cash += gross * (1 - FEE);
    b.open = b.open.filter(x => x !== p);
    b.closed.unshift({ ...p, exit, exitAt, why, pnl: Math.round(pnl * 100) / 100 });
    msgs.push(`📒 PAPER pump exit ${p.sym} (${why}) @ $${fmt(exit)} · P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  }

  for (const h of breaks) {
    if (h.dir !== 'up' || h.kind !== 'breakout' || h.level == null) continue;
    if (b.open.length >= MAX_OPEN || b.open.some(p => p.sym === h.sym)) continue;
    const lastT = closedT[h.sym]; if (lastT == null) continue;
    const entry = h.close, stop = h.level * (1 - STOP_BELOW), risk = entry - stop;
    if (risk <= 0) continue;
    const qty = Math.min(SLOT / entry, RISK_USD / risk, b.cash / (entry * (1 + FEE)));
    if (!(qty > 0) || qty * entry < 20) continue;                          // too small to bother
    b.cash -= qty * entry * (1 + FEE);
    const p: Pos = { sym: h.sym, entry, qty, stop, target: entry + R_MULT * risk, at, level: h.level, from: lastT + 15 * 60e3 };
    b.open.push(p);
    msgs.push(`📒 PAPER pump buy ${h.sym} $${(qty * entry).toFixed(0)} @ $${fmt(entry)} · stop $${fmt(p.stop)} · target $${fmt(p.target)}`);
  }
  b.closed = b.closed.slice(0, 200);
  if (msgs.length) b.updated = at;
  return msgs;
}
