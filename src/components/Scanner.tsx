'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATS } from '@/lib/config';
import { TFS, tfDef, type Bar, type Ticker, type TfId } from '@/lib/types';
import { analyse, type Analysis } from '@/lib/signal';
import { Chart } from './Chart';
import { AlertsPanel } from './AlertsPanel';
import { ago, big, fmtN, px, tLabel } from './format';

type Rec = { bars: Bar[]; at: number; inst?: string; err?: 'not_listed' | 'unavailable' };
type SigF = 'all' | 'buy' | 'sell' | 'neutral';
type SortKey = 'score' | 'chg' | 'vol' | 'rsi' | 'name';

const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const catLabel = (sym: string) => CATS.find(c => (c.coins as readonly string[]).includes(sym))?.label ?? 'My coins';
const tickKey = (sym: string) => sym + 'USD';

function liveBars(bars: Bar[], last?: number): Bar[] {
  if (!bars.length || last == null || !isFinite(last)) return bars;
  const b = bars.slice(), l = { ...b[b.length - 1] };
  l.c = last; l.h = Math.max(l.h, last); l.l = Math.min(l.l, last); b[b.length - 1] = l;
  return b;
}

export function Scanner() {
  const [cat, setCat] = useState('meme');
  const [tf, setTf] = useState<TfId>('1h');
  const [sigF, setSigF] = useState<SigF>('all');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [cur, setCur] = useState('DOGE');
  const [mine, setMine] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, Rec>>({});
  const [tick, setTick] = useState<Record<string, Ticker> | null>(null);
  const [tickAt, setTickAt] = useState(0);
  const [addv, setAddv] = useState('');
  const [ready, setReady] = useState(false);
  const [, force] = useState(0);

  useEffect(() => { // restore per-viewer choices
    setCat(ls.get('cs.cat', 'meme')); setTf(ls.get<TfId>('cs.tf', '1h')); setSigF(ls.get<SigF>('cs.sf', 'all'));
    setSortBy(ls.get<SortKey>('cs.sort', 'score')); setCur(ls.get('cs.cur', 'DOGE')); setMine(ls.get<string[]>('cs.mine', [])); setReady(true);
  }, []);
  useEffect(() => { if (ready) { ls.set('cs.cat', cat); ls.set('cs.tf', tf); ls.set('cs.sf', sigF); ls.set('cs.sort', sortBy); ls.set('cs.cur', cur); ls.set('cs.mine', mine); } }, [ready, cat, tf, sigF, sortBy, cur, mine]);

  const cats = useMemo(() => [
    { id: 'all', label: 'All', coins: [...new Set([...CATS.flatMap(c => c.coins as readonly string[]), ...mine])] },
    ...CATS.map(c => ({ id: c.id as string, label: c.label as string, coins: [...c.coins] as string[] })),
    ...(mine.length ? [{ id: 'mine', label: 'My coins', coins: mine }] : []),
  ], [mine]);
  const coins = useMemo(() => (cats.find(c => c.id === cat) ?? cats[0]).coins, [cats, cat]);
  const T = tfDef(tf);

  // --- polling (only while the tab is visible) ---
  const loadCandles = useCallback(async (signal: AbortSignal) => {
    const jobs = [...coins.map(s => ({ sym: s, role: 'scan', count: 120 })), { sym: cur, role: 'chart', count: 300 }];
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++], key = `${j.sym}|${tf}|${j.role}`;
        try {
          const r = await fetch(`/api/candles?sym=${j.sym}&tf=${tf}&count=${j.count}`, { signal });
          const body = await r.json();
          if (r.ok) setData(d => ({ ...d, [key]: { bars: body.bars, at: body.at, inst: body.inst } }));
          else setData(d => ({ ...d, [key]: { bars: d[key]?.bars ?? [], at: d[key]?.at ?? 0, err: body.error === 'not_listed' ? 'not_listed' : 'unavailable' } }));
        } catch { if (signal.aborted) return; }
      }
    }));
  }, [coins, cur, tf]);
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const run = () => { if (!document.hidden) loadCandles(ctl.signal); };
    run(); const id = setInterval(run, 60000);
    document.addEventListener('visibilitychange', run);
    return () => { ctl.abort(); clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, [ready, loadCandles]);
  useEffect(() => {
    if (!ready) return;
    const run = async () => {
      if (document.hidden) return;
      try { const r = await fetch('/api/tickers'); if (r.ok) { const j = await r.json(); setTick(j.map); setTickAt(j.at); } } catch { /* retry next tick */ }
    };
    run(); const id = setInterval(run, 30000);
    return () => clearInterval(id);
  }, [ready]);
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 30000); return () => clearInterval(id); }, []);

  const rowOf = useCallback((sym: string) => {
    const chart = data[`${sym}|${tf}|chart`], scan = data[`${sym}|${tf}|scan`];
    const d = sym === cur && chart?.bars.length ? chart : scan ?? chart;
    const t = tick?.[tickKey(sym)] ?? tick?.[sym + 'USDT'];
    const bars = d ? liveBars(d.bars, t?.last) : [];
    const a: Analysis | null = bars.length >= 35 ? analyse(bars, T) : null;
    return { sym, d, a, t };
  }, [data, tf, cur, tick, T]);

  const rows = useMemo(() => {
    let r = coins.map(rowOf);
    const counts = { buy: 0, sell: 0, neutral: 0 };
    for (const x of r) if (x.a) counts[x.a.kind]++;
    if (sigF !== 'all') r = r.filter(x => x.a?.kind === sigF);
    const key: Record<SortKey, (x: ReturnType<typeof rowOf>) => number> = {
      score: x => x.a?.score ?? -99, chg: x => x.t?.chg ?? -1e9, vol: x => x.t?.vol ?? -1, rsi: x => x.a?.R[x.a.n] ?? -1, name: () => 0,
    };
    if (sortBy === 'name') r.sort((x, y) => x.sym.localeCompare(y.sym)); else r.sort((x, y) => key[sortBy](y) - key[sortBy](x));
    return { r, counts };
  }, [coins, rowOf, sigF, sortBy]);

  const detail = rowOf(cur);
  const a = detail.a;
  const live = Boolean(tick) || Object.values(data).some(d => d.bars.length);
  const loaded = coins.filter(s => { const d = rowOf(s).d; return d && (d.bars.length || d.err); }).length;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const v = addv.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(USDT|USD)$/, '');
    if (!v) return;
    if (!CATS.some(c => (c.coins as readonly string[]).includes(v)) && !mine.includes(v)) setMine(m => [...m, v]);
    setAddv(''); setCur(v); if (!coins.includes(v)) setCat(mine.includes(v) ? 'mine' : 'all');
  };
  const badge = (k: string, label: string) => <span className={`b ${k === 'buy' ? 'up' : k === 'sell' ? 'dn' : 'nu'}`}>{label}</span>;
  const vb = (s: number) => (s > 0 ? <span className="b up">Bull</span> : s < 0 ? <span className="b dn">Bear</span> : <span className="b nu">Flat</span>);
  const daily = tf === '1D';
  const ch = detail.t?.chg;

  return (
    <main>
      <header className="top">
        <h1>Crypto Signal Scanner</h1>
        <div className="mkt"><span className={'dot' + (live ? ' live' : '')} /><span>{live ? `Crypto.com live · 24/7${tickAt ? ' · prices ' + ago(tickAt) : ''}` : 'Connecting to Crypto.com…'}</span></div>
      </header>

      <div className="bar">
        <div className="tabs" role="group" aria-label="Category">
          {cats.map(c => <button key={c.id} className="tab" aria-pressed={c.id === cat} onClick={() => { setCat(c.id); if (!c.coins.includes(cur)) setCur(c.coins[0]); }}>{c.label}<span className="n">{c.coins.length}</span></button>)}
        </div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Timeframe">
          {TFS.map(t => <button key={t.id} aria-pressed={t.id === tf} onClick={() => setTf(t.id)}>{t.id}</button>)}
        </div>
      </div>
      <div className="bar">
        <div className="seg" role="group" aria-label="Signal filter">
          {(['all', 'buy', 'sell', 'neutral'] as SigF[]).map(v => <button key={v} aria-pressed={v === sigF} onClick={() => setSigF(v)}>{v === 'all' ? 'All signals' : v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
        <label className="fresh" htmlFor="sort">Sort</label>
        <select id="sort" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}>
          <option value="score">Signal score</option><option value="chg">24h change</option><option value="vol">24h volume</option><option value="rsi">RSI</option><option value="name">Name</option>
        </select>
        <span className="spacer" />
        <form className="bar" onSubmit={add}><input className="tx" id="addi" value={addv} onChange={e => setAddv(e.target.value)} placeholder="Add coin, e.g. ARB" aria-label="Add coin" /><button className="btn">Add</button></form>
      </div>

      <section className="panel">
        <div className="sum">
          <span className="up"><b>{rows.counts.buy}</b> buy</span><span className="dn"><b>{rows.counts.sell}</b> sell</span><span><b>{rows.counts.neutral}</b> neutral</span>
          <span>{loaded}/{coins.length} loaded · {tf} candles</span>
        </div>
        <div className="wl"><table>
          <thead><tr><th>Coin</th><th className="r">Price</th><th className="r">24h</th><th className="r">24h vol</th><th>Signal</th><th className="r">Score</th><th className="r">RSI</th><th>Supertrend</th><th>Last flip</th></tr></thead>
          <tbody>
            {rows.r.length === 0 ? <tr><td colSpan={9} className="fresh">{sigF === 'all' ? 'Loading…' : `No coins in this category show a ${sigF} signal on ${tf} right now.`}</td></tr> :
              rows.r.map(({ sym, d, a: ra, t }) => {
                const p = t?.last ?? (ra ? ra.C[ra.n] : null), c = t?.chg ?? null;
                return (
                  <tr key={sym} tabIndex={0} className={sym === cur ? 'cur' : ''} onClick={() => setCur(sym)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCur(sym); } }}>
                    <td><b>{sym}</b> <span className="cat">{catLabel(sym)}</span></td>
                    <td className="num">{px(p)}</td>
                    <td className={'num chg ' + (c != null && c > 0 ? 'up' : c != null && c < 0 ? 'dn' : '')}>{c == null ? '–' : (c > 0 ? '+' : '') + fmtN(c) + '%'}</td>
                    <td className="num">{big(t?.vol)}</td>
                    <td>{ra ? badge(ra.kind, ra.label) : d?.err === 'not_listed' ? <span className="b nu">Not listed</span> : d?.err ? <span className="b nu">No data</span> : <span className="fresh">loading…</span>}</td>
                    <td className="num">{ra ? (ra.score > 0 ? '+' : '') + ra.score : '–'}</td>
                    <td className="num">{ra ? fmtN(ra.R[ra.n], 0) : '–'}</td>
                    <td>{ra ? (ra.ST.dir[ra.n] === 1 ? <span className="b up">Up</span> : <span className="b dn">Down</span>) : '–'}</td>
                    <td className="fresh">{ra?.lastFlip ? (ra.lastFlip.dir === 1 ? '▲ ' : '▼ ') + tLabel(ra.bars[ra.lastFlip.i].t, daily) : '–'}</td>
                  </tr>
                );
              })}
          </tbody>
        </table></div>
      </section>

      <div className="grid">
        <section className="panel chartwrap">
          <div className="chead">
            <span className="nm">{cur} · {detail.d?.inst ?? `${cur}_USD`}</span>
            <span className="px">{a ? px(a.C[a.n]) : '–'}</span>
            <span className={'chg ' + (ch != null && ch > 0 ? 'up' : ch != null && ch < 0 ? 'dn' : '')}>{ch == null ? '' : (ch > 0 ? '+' : '') + fmtN(ch) + '% 24h'}</span>
            <span className="fresh">{detail.d?.at ? 'candles ' + ago(detail.d.at) : ''}</span>
          </div>
          <div className="legend"><span><i style={{ background: 'var(--e1)' }} />EMA 9</span><span><i style={{ background: 'var(--e2)' }} />EMA 21</span><span><i style={{ background: 'var(--up)' }} />Supertrend (10,3)</span><span><i style={{ background: 'var(--ac)' }} />{a?.refName ?? 'VWAP'}</span><span>▲ buy flip ▼ sell flip</span></div>
          <Chart a={a} daily={daily} empty={detail.d?.err === 'not_listed' ? `${cur} is not listed on Crypto.com Exchange with a USD or USDT pair.` : detail.d?.err ? 'Cannot reach Crypto.com right now.' : 'Loading candles from Crypto.com…'} />
        </section>
        <aside className="side">
          <section className="panel sig">
            <div className="lbl">Signal · {tf} candles</div>
            <div className={'verdict ' + (a?.kind ?? 'neutral')}>{a?.label ?? 'No signal'}</div>
            {a && <>
              <div><div className="gauge">{Array.from({ length: 11 }, (_, i) => { const v = i - 5; const on = (a.score > 0 && v > 0 && v <= a.score) || (a.score < 0 && v < 0 && v >= a.score); return <span key={i} className={(on ? 'on ' + (v > 0 ? 'p' : 'n') : '') + (v === 0 ? ' mid' : '')} />; })}</div><div className="gscale"><span>−5 sell</span><span>0</span><span>buy +5</span></div></div>
              <p className="why">{a.votes.filter(x => x.score > 0).length} of 5 indicators bullish, {a.votes.filter(x => x.score < 0).length} bearish (score {a.score > 0 ? '+' : ''}{a.score}).{a.weak ? ' ADX under 20, so the trend is weak and signals are less reliable.' : ''}</p>
              <dl className="lv">
                <div><dt>Trailing stop (Supertrend)</dt><dd>{a.ST.line[a.n] ? px(a.ST.line[a.n]) + ' (' + (((a.ST.line[a.n]! / a.C[a.n]) - 1) * 100).toFixed(1) + '%)' : '–'}</dd></div>
                <div><dt>Last flip</dt><dd>{a.lastFlip ? (a.lastFlip.dir === 1 ? '▲ ' : '▼ ') + tLabel(a.bars[a.lastFlip.i].t, daily) : '–'}</dd></div>
                <div><dt>ATR (14)</dt><dd>{px(a.atr[a.n])}{a.atr[a.n] != null ? ' (' + (a.atr[a.n]! / a.C[a.n] * 100).toFixed(1) + '%)' : ''}</dd></div>
                <div><dt>Trend strength</dt><dd>{a.adx == null ? '–' : 'ADX ' + a.adx.toFixed(0) + (a.adx >= 25 ? ' strong' : a.adx >= 20 ? ' moderate' : ' weak')}</dd></div>
              </dl>
            </>}
          </section>
          {a && <section className="panel ind"><table><tbody>
            {a.votes.map(x => <tr key={x.name}><td>{x.name}<div className="fresh">{x.txt}</div></td>
              <td>{x.name.startsWith('RSI') ? fmtN(x.val, 1) : x.name.startsWith('MACD') ? Number((x.val ?? 0).toPrecision(3)) : x.name.startsWith('EMA') ? (x.val! > 0 ? '+' : '') + Number((x.val ?? 0).toPrecision(3)) : px(x.val)}</td><td>{vb(x.score)}</td></tr>)}
            <tr><td>ADX (14)<div className="fresh">+DI {fmtN(a.pdi, 0)} · −DI {fmtN(a.mdi, 0)}</div></td><td>{fmtN(a.adx, 1)}</td><td>{a.adx != null && a.adx >= 20 ? vb(a.pdi! > a.mdi! ? 1 : -1) : <span className="b nu">Weak</span>}</td></tr>
          </tbody></table></section>}
        </aside>
      </div>

      <AlertsPanel />

      <details className="how"><summary>How the signal is built</summary><ul>
        <li>Five votes, each +1 (bullish), −1 (bearish) or 0: Supertrend (10, 3) direction; EMA 9 vs EMA 21; MACD (12, 26, 9) histogram; RSI (14) above 55 or below 45; price vs VWAP (resets 00:00 UTC) on 15m and 1h, or vs the 50-candle average on 4h and 1D.</li>
        <li>Total +4 or +5 is Strong Buy, +2 or +3 Buy, −2 or −3 Sell, −4 or −5 Strong Sell. When ADX (14) is under 20 the trend is weak and &quot;Strong&quot; is downgraded.</li>
        <li>The table and chart use the live, still-forming candle. Alerts use closed candles only, so an alert never fires on a candle that can still change.</li>
        <li>Data: Crypto.com Exchange public market data (USD pairs, USDT if no USD pair). Crypto trades 24/7.</li>
      </ul></details>
      <p className="note">These are mechanical indicator readings, not investment advice. Crypto is highly volatile, meme tokens especially; indicators lag price, whipsaw in sideways markets, and nothing here guarantees a move in either direction. This app only reads market data and cannot place orders.</p>
    </main>
  );
}
