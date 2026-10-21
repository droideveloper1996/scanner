export const fmtN = (x: number | null | undefined, d = 2) =>
  x == null || !isFinite(x) ? '–' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export function px(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1000) return '$' + fmtN(x, 2);
  if (a >= 1) return '$' + fmtN(x, a >= 100 ? 2 : 3);
  if (a === 0) return '$0';
  return '$' + Number(x.toPrecision(4)).toString().replace(/^(-?)0\./, '$10.');
}
export function pxAxis(x: number): string {
  const a = Math.abs(x);
  return a >= 1000 ? fmtN(x, 0) : a >= 1 ? fmtN(x, a >= 100 ? 1 : 3) : Number(x.toPrecision(3)).toString();
}
export function big(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '–';
  return x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(0) + 'K' : '$' + x.toFixed(0);
}
export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
}
export const tLabel = (ms: number, daily: boolean) => {
  const iso = new Date(ms).toISOString();
  return daily ? iso.slice(0, 10) : iso.slice(5, 10) + ' ' + iso.slice(11, 16);
};
