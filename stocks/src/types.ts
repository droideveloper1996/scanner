export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type TfId = '15m' | '1h' | '4h' | '1D';
export type TfDef = { id: TfId; intraday: boolean; ms: number };
export const TFS: TfDef[] = [
  { id: '15m', intraday: true, ms: 15 * 60e3 },
  { id: '1h', intraday: true, ms: 3600e3 },
  { id: '4h', intraday: false, ms: 4 * 3600e3 },
  { id: '1D', intraday: false, ms: 24 * 3600e3 },
];
export const tfDef = (id: string): TfDef => TFS.find(t => t.id === id) ?? TFS[1];
export type Ticker = { last: number; chg: number | null; vol: number | null };
