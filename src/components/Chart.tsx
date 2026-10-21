'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis } from '@/lib/signal';
import type { Series } from '@/lib/indicators';
import { fmtN, pxAxis, tLabel } from './format';

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function line(g: CanvasRenderingContext2D, arr: Series, s0: number, X: (i: number) => number, Y: (v: number) => number, col: string, w: number, dash: number[] = []) {
  g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash); g.beginPath();
  let st = false;
  for (let i = s0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) { st = false; continue; }
    const x = X(i), y = Y(v);
    if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y);
  }
  g.stroke(); g.setLineDash([]);
}
const niceStep = (r: number) => { const p = Math.pow(10, Math.floor(Math.log10(r))), f = r / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };

export function Chart({ a, daily, empty }: { a: Analysis | null; daily: boolean; empty?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const draw = useCallback(() => {
    const cv = ref.current; if (!cv) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = r.width, H = Math.max(420, Math.min(560, r.width * 0.75));
    cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = css;
    if (!a) { g.fillStyle = C('--mut'); g.font = '13px IBM Plex Sans, sans-serif'; g.textAlign = 'center'; g.fillText(empty || 'Loading candles…', W / 2, H / 2, W - 32); return; }
    const N = Math.min(a.bars.length, Math.max(40, Math.floor((W - 64) / 7))), s0 = a.bars.length - N;
    const padR = 64, plotW = W - padR, bw = plotW / N;
    const p1 = [0, H * 0.62], p2 = [H * 0.62 + 8, H * 0.8], p3 = [H * 0.8 + 8, H - 18];
    let lo = Infinity, hi = -Infinity;
    for (let i = s0; i < a.bars.length; i++) { const b = a.bars[i]; lo = Math.min(lo, b.l, a.ST.line[i] ?? Infinity); hi = Math.max(hi, b.h, a.ST.line[i] ?? -Infinity); }
    const pad = (hi - lo) * 0.06 || hi * 0.01; lo -= pad; hi += pad;
    const X = (i: number) => (i - s0 + 0.5) * bw, Y = (v: number) => p1[0] + ((hi - v) / (hi - lo)) * (p1[1] - p1[0]);
    g.font = '11px IBM Plex Mono, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.strokeStyle = C('--grid'); g.fillStyle = C('--mut'); g.lineWidth = 1;
    const step = niceStep((hi - lo) / 5);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.fillText(pxAxis(v), plotW + 6, y); }
    for (const p of [p2, p3]) { g.beginPath(); g.moveTo(0, p[0] - 4 + 0.5); g.lineTo(W, p[0] - 4 + 0.5); g.strokeStyle = C('--ln'); g.stroke(); }
    for (let i = s0 + 1; i < a.bars.length; i++) {
      const l0 = a.ST.line[i - 1], l1 = a.ST.line[i];
      if (l0 == null || l1 == null || a.ST.dir[i] !== a.ST.dir[i - 1]) continue;
      g.strokeStyle = a.ST.dir[i] === 1 ? C('--up') : C('--dn'); g.globalAlpha = 0.75; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(i - 1), Y(l0)); g.lineTo(X(i), Y(l1)); g.stroke();
    }
    g.globalAlpha = 1;
    line(g, a.ref, s0, X, Y, C('--ac'), 1.2, [4, 3]);
    for (let i = s0; i < a.bars.length; i++) {
      const b = a.bars[i], up = b.c >= b.o, col = up ? C('--up') : C('--dn');
      g.strokeStyle = col; g.fillStyle = col; const x = X(i); g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(b.h)); g.lineTo(Math.round(x) + 0.5, Y(b.l)); g.stroke();
      const w = Math.max(1, bw * 0.62), yo = Y(b.o), yc = Y(b.c);
      g.fillRect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yc - yo)));
    }
    line(g, a.e9, s0, X, Y, C('--e1'), 1.5); line(g, a.e21, s0, X, Y, C('--e2'), 1.5);
    for (const m of a.marks) {
      if (m.i < s0) continue;
      const b = a.bars[m.i], x = X(m.i); g.fillStyle = m.s > 0 ? C('--up') : C('--dn'); g.beginPath();
      if (m.s > 0) { const y = Y(b.l) + 10; g.moveTo(x, y - 5); g.lineTo(x - 5, y + 4); g.lineTo(x + 5, y + 4); }
      else { const y = Y(b.h) - 10; g.moveTo(x, y + 5); g.lineTo(x - 5, y - 4); g.lineTo(x + 5, y - 4); }
      g.fill();
    }
    const lp = a.C[a.n], ly = Y(lp);
    g.fillStyle = lp >= a.bars[a.n].o ? C('--up') : C('--dn'); g.fillRect(plotW + 1, ly - 9, padR - 2, 18);
    g.fillStyle = C('--bg'); g.fillText(pxAxis(lp), plotW + 6, ly);
    const Yr = (v: number) => p2[0] + ((100 - v) / 100) * (p2[1] - p2[0]);
    g.fillStyle = C('--sf2'); g.fillRect(0, Yr(70), plotW, Yr(30) - Yr(70));
    g.fillStyle = C('--mut'); for (const v of [70, 30]) g.fillText(String(v), plotW + 6, Yr(v));
    g.fillText('RSI ' + fmtN(a.R[a.n], 1), 4, p2[0] + 6);
    line(g, a.R, s0, X, Yr, C('--ac'), 1.4);
    let mx = 0;
    for (let i = s0; i < a.bars.length; i++) mx = Math.max(mx, Math.abs(a.M.m[i] || 0), Math.abs(a.M.sg[i] || 0), Math.abs(a.M.h[i] || 0));
    mx = mx || 1;
    const mid = (p3[0] + p3[1]) / 2, Ym = (v: number) => mid - (v / mx) * ((p3[1] - p3[0]) / 2);
    for (let i = s0; i < a.bars.length; i++) {
      const h = a.M.h[i]; if (h == null) continue;
      g.fillStyle = h >= 0 ? C('--up') : C('--dn'); g.globalAlpha = 0.55;
      const w = Math.max(1, bw * 0.62); g.fillRect(X(i) - w / 2, Math.min(mid, Ym(h)), w, Math.abs(Ym(h) - mid));
    }
    g.globalAlpha = 1; line(g, a.M.m, s0, X, Ym, C('--e1'), 1.3); line(g, a.M.sg, s0, X, Ym, C('--e2'), 1.3);
    g.fillStyle = C('--mut'); g.fillText('MACD (12,26,9)', 4, p3[0] + 6);
    g.textAlign = 'center'; const every = Math.ceil(N / 6);
    for (let i = s0; i < a.bars.length; i += every) g.fillText(tLabel(a.bars[i].t, daily), Math.min(Math.max(X(i), 36), plotW - 36), H - 8);
    if (hover != null) {
      const i = Math.min(a.bars.length - 1, s0 + Math.max(0, Math.floor(hover / bw))), b = a.bars[i], x = X(i);
      g.strokeStyle = C('--mut'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - 18); g.stroke(); g.setLineDash([]);
      const txt = `${tLabel(b.t, daily)} UTC  O ${pxAxis(b.o)} H ${pxAxis(b.h)} L ${pxAxis(b.l)} C ${pxAxis(b.c)}  RSI ${fmtN(a.R[i], 0)}`;
      g.textAlign = 'left'; const tw = g.measureText(txt).width + 12, tx = Math.min(Math.max(4, x - tw / 2), Math.max(4, plotW - tw));
      g.fillStyle = C('--sf2'); g.fillRect(tx, 4, tw, 20); g.fillStyle = C('--fg'); g.fillText(txt, tx + 6, 14);
    }
  }, [a, daily, empty, hover]);

  useEffect(() => { draw(); }, [draw, tick]);
  useEffect(() => {
    const on = () => setTick(t => t + 1);
    window.addEventListener('resize', on);
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', on);
    return () => { window.removeEventListener('resize', on); mq.removeEventListener('change', on); };
  }, []);

  return (
    <canvas ref={ref} height={560} aria-label="Price chart with indicators"
      onMouseMove={e => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)} onMouseLeave={() => setHover(null)} />
  );
}
