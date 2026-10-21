import type { Bar } from './types';

export type Series = (number | null)[];

export function ema(a: Series, n: number): Series {
  const k = 2 / (n + 1), o: Series = [];
  let p: number | null = null;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v == null) { o.push(null); continue; }
    p = p == null ? v : v * k + p * (1 - k);
    o.push(i >= n - 1 ? p : null);
  }
  return o;
}

export function sma(a: number[], n: number): Series {
  const o: Series = []; let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    o.push(i >= n - 1 ? s / n : null);
  }
  return o;
}

export function rsi(c: number[], n = 14): Series {
  const o: Series = Array(c.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    } else {
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return o;
}

export function macd(c: number[]) {
  const f = ema(c, 12), s = ema(c, 26);
  const m: Series = c.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null));
  const st = m.findIndex(v => v != null);
  const sg: Series = Array(c.length).fill(null);
  if (st >= 0) { const e = ema(m.slice(st), 9); for (let i = 0; i < e.length; i++) sg[st + i] = e[i]; }
  const h: Series = m.map((v, i) => (v != null && sg[i] != null ? v - sg[i]! : null));
  return { m, sg, h };
}

export function trueRange(H: number[], L: number[], C: number[]): number[] {
  return H.map((h, i) => (i ? Math.max(h - L[i], Math.abs(h - C[i - 1]), Math.abs(L[i] - C[i - 1])) : h - L[i]));
}

export function wilder(a: number[], n: number): Series {
  const o: Series = Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (i < n) { s += a[i]; if (i === n - 1) o[i] = s / n; }
    else o[i] = ((o[i - 1] as number) * (n - 1) + a[i]) / n;
  }
  return o;
}

export function supertrend(H: number[], L: number[], C: number[], n = 10, m = 3) {
  const atr = wilder(trueRange(H, L, C), n);
  const line: Series = Array(C.length).fill(null);
  const dir: number[] = Array(C.length).fill(0);
  let fu: number | null = null, fl: number | null = null;
  for (let i = 0; i < C.length; i++) {
    if (atr[i] == null) continue;
    const hl = (H[i] + L[i]) / 2, bu = hl + m * atr[i]!, bl = hl - m * atr[i]!;
    fu = fu == null || bu < fu || C[i - 1] > fu ? bu : fu;
    fl = fl == null || bl > fl || C[i - 1] < fl ? bl : fl;
    const pd = dir[i - 1] || 1;
    let d = pd;
    if (pd === 1 && C[i] < fl) d = -1; else if (pd === -1 && C[i] > fu) d = 1;
    dir[i] = d; line[i] = d === 1 ? fl : fu;
  }
  return { line, dir };
}

export function adx(H: number[], L: number[], C: number[], n = 14) {
  const len = C.length, pdm = [0], mdm = [0];
  for (let i = 1; i < len; i++) {
    const u = H[i] - H[i - 1], d = L[i - 1] - L[i];
    pdm.push(u > d && u > 0 ? u : 0); mdm.push(d > u && d > 0 ? d : 0);
  }
  const tr = wilder(trueRange(H, L, C), n), sp = wilder(pdm, n), sm = wilder(mdm, n);
  const pdi: Series = [], mdi: Series = [], dx: Series = [];
  for (let i = 0; i < len; i++) {
    if (tr[i] == null || !tr[i]) { pdi.push(null); mdi.push(null); dx.push(null); continue; }
    const p = (100 * sp[i]!) / tr[i]!, q = (100 * sm[i]!) / tr[i]!;
    pdi.push(p); mdi.push(q); dx.push(p + q ? (100 * Math.abs(p - q)) / (p + q) : 0);
  }
  const st = dx.findIndex(v => v != null);
  const a: Series = Array(len).fill(null);
  if (st >= 0) { const w = wilder(dx.slice(st) as number[], n); for (let i = 0; i < w.length; i++) a[st + i] = w[i]; }
  return { adx: a, pdi, mdi };
}

/** VWAP that resets at 00:00 UTC. */
export function vwap(bars: Bar[]): number[] {
  const o: number[] = []; let pv = 0, v = 0, day = '';
  for (const b of bars) {
    const d = new Date(b.t).toISOString().slice(0, 10);
    if (d !== day) { day = d; pv = 0; v = 0; }
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v; v += b.v;
    o.push(v ? pv / v : tp);
  }
  return o;
}
