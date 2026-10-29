"""Event study for the pre-breakout detector on daily candles.
Usage: python3 bt_prebreakout.py stocks|crypto [--split 2024-10-11] [--out results.json]
stocks: /mnt/project-files/stock-lab/hist/*.json (5y Groww daily). crypto: a folder of [[date,o,h,l,c,v],...] files.
Groups (each with its own 10-bar cooldown per symbol, so one setup = one event):
  signal   = detector fires (gate + score >= 2)
  strong   = score >= 2.5
  baseline = gate only: close within 1.5 ATR under the 40-bar high, any score (the "near resistance" control)
  weak     = gate and score < 2
Outcomes: breakout = any close above R in the next 10 bars. Trade = buy-stop at R+0.1% for 10 bars,
stop at the last higher low (if 0.5-3 ATR away) else 1.5 ATR, target 2R, time exit 20 bars, 0.36% round-trip cost.
False positive = signal whose breakout never came, or came and failed (close back under R within 3 bars or stopped out).
"""
import json, glob, os, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prebreakout import prep, detect

COST = 0.0036


def trade(S, i, d):
    H, L, C, O = S['H'], S['L'], S['C'], S['O']; n = S['n']; trig = d['R'] * 1.001; a = d['atr']
    for j in range(i + 1, min(i + 11, n)):
        if H[j] >= trig:
            e = max(O[j], trig); hl = d['swing_low']
            stop = hl * 0.999 if hl and 0.5 * a <= e - hl * 0.999 <= 3 * a else e - 1.5 * a
            risk = e - stop; tgt = e + 2 * risk; ex = None
            fail = any(C[k] < d['R'] for k in range(j, min(j + 3, n)))
            for k in range(j, min(j + 21, n)):
                if L[k] <= stop: ex = min(O[k], stop) if k > j else stop; break
                if H[k] >= tgt: ex = max(O[k], tgt) if k > j else tgt; break
            if ex is None:
                if j + 20 >= n: return dict(trig=True, open=True)
                ex = C[j + 20]
            R = (ex - e - COST * e) / risk
            return dict(trig=True, R=R, win=R > 0, fail=fail or ex <= stop)
    return dict(trig=False)


def run(series, split):
    groups = {g: {'IS': [], 'OOS': []} for g in ('signal', 'strong', 'baseline', 'weak')}
    allbars = {'IS': [], 'OOS': []}; recall = {'IS': [0, 0], 'OOS': [0, 0]}
    for sym, rows in series.items():
        S = prep(rows); n = S['n']; last = {g: -99 for g in groups}; sig_days = set()
        for i in range(130, n - 1):
            per = 'IS' if str(rows[i][0])[:10] < split else 'OOS'
            d = detect(S, i)
            if not d: continue
            if d['signal']: sig_days.add(i)
            R40 = d['R']
            if i + 10 < n:
                allbars[per].append(dict(bo=any(S['C'][k] > R40 for k in range(i + 1, i + 11)), fwd=S['C'][i + 10] / S['C'][i] - 1))
            # recall: first close above the 40-bar high, was a signal logged in the 10 bars before?
            if S['C'][i] > R40 and S['C'][i - 1] <= max(S['H'][i - 41:i - 1]):
                recall[per][1] += 1; recall[per][0] += any(k in sig_days for k in range(i - 10, i))
            if not d['gate'] or i + 10 >= n: continue
            tags = ['baseline'] + (['signal'] if d['signal'] else ['weak']) + (['strong'] if d['strong'] else [])
            for g in tags:
                if i - last[g] < 10: continue
                last[g] = i
                ev = dict(sym=sym, date=str(rows[i][0])[:10], score=d['score'], bo=any(S['C'][k] > d['R'] for k in range(i + 1, i + 11)),
                          fwd=S['C'][i + 10] / S['C'][i] - 1); ev.update(trade(S, i, d)); groups[g][per].append(ev)
    return groups, allbars, recall


def summ(evs):
    if not evs: return dict(n=0)
    t = [e for e in evs if e.get('trig') and 'R' in e]; m = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    gw = sum(e['R'] for e in t if e['R'] > 0); gl = -sum(e['R'] for e in t if e['R'] < 0)
    fp = sum(1 for e in evs if not e['bo'] or e.get('fail'))
    return dict(n=len(evs), breakout_10d=round(sum(e['bo'] for e in evs) / len(evs) * 100, 1), fwd10_pct=round(m([e['fwd'] for e in evs]) * 100, 2),
                trades=len(t), win_pct=round(sum(e['win'] for e in t) / len(t) * 100, 1) if t else None, avg_R=m([e['R'] for e in t]),
                pf=round(gw / gl, 2) if gl else None, false_pos_pct=round(fp / len(evs) * 100, 1))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('kind'); ap.add_argument('src', nargs='?'); ap.add_argument('--split', default='2024-10-11'); ap.add_argument('--out')
    a = ap.parse_args(); series = {}
    if a.kind == 'stocks':
        for p in sorted(glob.glob('/mnt/project-files/stock-lab/hist/*.json')):
            s = os.path.basename(p)[:-5]
            if s in ('NIFTY', 'BANKNIFTY'): continue
            series[s] = json.load(open(p))
    else:
        for p in sorted(glob.glob(os.path.join(a.src, '*.json'))):
            d = json.load(open(p)); d = d.get('data', d) if isinstance(d, dict) else d
            if d and isinstance(d[0], dict):
                d = [[x['timestamp'][:10], x['open'], x['high'], x['low'], x['close'], x.get('volume', 0)] for x in d]
            series[os.path.basename(p)[:-5]] = sorted(d, key=lambda r: r[0])
    groups, allbars, recall = run(series, a.split)
    res = {'kind': a.kind, 'split': a.split, 'symbols': len(series), 'all_bars': {}, 'groups': {}, 'recall': {}}
    for per in ('IS', 'OOS'):
        ab = allbars[per]
        res['all_bars'][per] = dict(n=len(ab), breakout_10d=round(sum(x['bo'] for x in ab) / len(ab) * 100, 1) if ab else None,
                                    fwd10_pct=round(sum(x['fwd'] for x in ab) / len(ab) * 100, 2) if ab else None)
        res['recall'][per] = dict(breakouts=recall[per][1], flagged_before=recall[per][0], pct=round(recall[per][0] / recall[per][1] * 100, 1) if recall[per][1] else None)
        for g in groups: res['groups'].setdefault(g, {})[per] = summ(groups[g][per])
    res['events'] = {g: groups[g]['OOS'][-40:] for g in ('signal',)}
    print(json.dumps({k: v for k, v in res.items() if k != 'events'}, indent=1))
    if a.out: json.dump(res, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
