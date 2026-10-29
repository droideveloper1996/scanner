"""Test each of the 11 PreBreakoutScanner signals on its own, plus equal-weight counts, vs baselines. Same trade test as
bt_prebreakout.py: buy-stop at R+0.1% for 10 bars, stop at last swing low (0.5-3 ATR) else 1.5 ATR, 2R target, 20-bar exit, 0.36% cost.
Usage: python3 bt_features.py stocks | crypto <dir> [--split 2024-10-11] [--out f.json]"""
import json, glob, os, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import PreBreakoutScanner, NAMES
COST = 0.0036


def trade(S, i, R, a, hl):
    H, L, C, O, n = S.H, S.L, S.C, S.O, S.n; trig = R * 1.001
    for j in range(i + 1, min(i + 11, n)):
        if H[j] >= trig:
            e = max(O[j], trig); stop = hl * 0.999 if hl and 0.5 * a <= e - hl * 0.999 <= 3 * a else e - 1.5 * a
            risk = e - stop; tgt = e + 2 * risk; ex = None
            for k in range(j, min(j + 21, n)):
                if L[k] <= stop: ex = min(O[k], stop) if k > j else stop; break
                if H[k] >= tgt: ex = max(O[k], tgt) if k > j else tgt; break
            if ex is None:
                if j + 20 >= n: return None
                ex = C[j + 20]
            return (ex - e - COST * e) / risk
    return 'none'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('kind'); ap.add_argument('src', nargs='?'); ap.add_argument('--split', default='2024-10-11'); ap.add_argument('--out')
    a = ap.parse_args(); series = {}; index = None
    if a.kind == 'stocks':
        for p in sorted(glob.glob('/mnt/project-files/stock-lab/hist/*.json')):
            s = os.path.basename(p)[:-5]; d = json.load(open(p))
            if s == 'NIFTY': index = d
            if s not in ('NIFTY', 'BANKNIFTY'): series[s] = d
    else:
        for p in sorted(glob.glob(os.path.join(a.src, '*.json'))):
            s = os.path.basename(p)[:-5]; d = sorted(json.load(open(p)), key=lambda r: r[0]); series[s] = d
            if s == 'BTC': index = d
    groups = ['all_bars', 'gate'] + NAMES + ['count>=2', 'count>=3']
    acc = {(g, p): [] for g in groups for p in ('IS', 'OOS')}
    for sym, rows in series.items():
        S = PreBreakoutScanner(rows, None if (a.kind == 'crypto' and sym == 'BTC') else index); last = {}
        for i in range(80, S.n - 11):
            b = S.bar(i)
            if not b: continue
            per = 'IS' if S.D[i] < a.split else 'OOS'
            tags = ['all_bars'] + (['gate'] if b['gate'] else []) + [k for k in NAMES if b['sig'][k]]
            if b['count'] >= 2: tags.append('count>=2')
            if b['count'] >= 3: tags.append('count>=3')
            for g in tags:
                if g != 'all_bars' and i - last.get(g, -99) < 10: continue
                last[g] = i
                bo = any(S.C[k] > b['R'] for k in range(i + 1, i + 11)); fwd = S.C[i + 10] / S.C[i] - 1
                r = trade(S, i, b['R'], b['atr'], b['swing_low']) if g != 'all_bars' else 'none'
                acc[(g, per)].append((bo, fwd, r))
    res = {}
    for (g, p), ev in acc.items():
        if not ev: res.setdefault(g, {})[p] = {'n': 0}; continue
        t = [r for _, _, r in ev if isinstance(r, float)]; gw = sum(x for x in t if x > 0); gl = -sum(x for x in t if x < 0)
        res.setdefault(g, {})[p] = dict(n=len(ev), bo=round(100 * sum(e[0] for e in ev) / len(ev), 1), fwd=round(100 * sum(e[1] for e in ev) / len(ev), 2),
                                        trades=len(t), win=round(100 * sum(x > 0 for x in t) / len(t), 1) if t else None,
                                        R=round(sum(t) / len(t), 3) if t else None, pf=round(gw / gl, 2) if gl else None)
    print(f"{a.kind}: {len(series)} symbols, split {a.split}")
    print(f"{'signal':13}| {'IS n':>5} {'bo%':>5} {'fwd%':>6} {'tr':>4} {'avgR':>6} {'PF':>5} | {'OOS n':>5} {'bo%':>5} {'fwd%':>6} {'tr':>4} {'avgR':>6} {'PF':>5}")
    for g in groups:
        row = f"{g:13}|"
        for p in ('IS', 'OOS'):
            x = res[g][p]; f = lambda k: '' if x.get(k) is None else x[k]
            row += f" {x['n']:>5} {f('bo'):>5} {f('fwd'):>6} {f('trades'):>4} {f('R'):>6} {f('pf'):>5} |"
        print(row)
    if a.out: json.dump(res, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
