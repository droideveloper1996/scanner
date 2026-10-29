"""PreBreakoutScanner: 11 pre-breakout signals on daily OHLCV, from Abhishek's reference list (28 Oct 2026).
Parameters are the list's own where it gives them, daily-adapted where it was written for intraday (marked DAILY).
Fixed before any test. Resistance R = highest high of the prior 20 bars. No look-ahead: bar i uses bars <= i only.

 1 squeeze     BB(20,2) width / KC(20,1.5 ATR) width < 0.85 for >= 5 bars in a row, TTM-style momentum rising, close within 1% of R
 2 vcp         last 3 pullbacks (swing high -> next swing low, 60 bars) each shallower than the one before, a bar in the last 3
               with the lowest volume of 20 bars, today an inside bar or pocket pivot closing in the top 25% of its range
 3 id_nr       inside bar that is also NR4 or NR7 (narrowest range of 4 or 7 bars), close within 1.5 ATR of R
 4 asc_tri     20-bar regression slope of highs flat (|move| < 0.5 ATR), of lows rising (> 0.5 ATR), >= 3 touches of R (0.3 ATR)
 5 shelf       DAILY: 8-bar range < 1.5 ATR, close within 0.5 ATR of R, volume > 1.3x its 10-bar average
 6 spring      low undercuts the prior 10-bar low, close back above it, lower wick > 60% of range, volume > 20-bar average
 7 pocket_pivot  green bar, volume > largest down-bar volume of prior 10, close within 2% of EMA10 or EMA20, below R
 8 obv_div     OBV at a 25-bar high while close is below the prior 25-bar high
 9 vdu         yesterday's volume < 45% of its 20-bar average, today closes above yesterday's high, below R
10 avwap_pinch DAILY: VWAP anchored at the 60-bar low (rising support) is below the close and within 1.5 ATR of R
11 rs_lead     stock/index ratio at a 20-bar high while price is below its prior 20-bar high (index: NIFTY for stocks, BTC for crypto)
Gate ("near resistance", the baseline): close below R and within 1.5 ATR of it.
"""
import math

NAMES = ['squeeze', 'vcp', 'id_nr', 'asc_tri', 'shelf', 'spring', 'pocket_pivot', 'obv_div', 'vdu', 'avwap_pinch', 'rs_lead']


def _ema(a, n):
    k, p, o = 2 / (n + 1), None, []
    for v in a:
        p = v if p is None else v * k + p * (1 - k); o.append(p)
    return o


def _atr(H, L, C, n):
    tr = [H[0] - L[0]] + [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]
    o, s = [None] * len(C), 0.0
    for i, v in enumerate(tr):
        if i < n:
            s += v
            if i == n - 1: o[i] = s / n
        else: o[i] = (o[i - 1] * (n - 1) + v) / n
    return o


def _slope(y):
    n = len(y); mx = (n - 1) / 2; my = sum(y) / n
    return sum((i - mx) * (v - my) for i, v in enumerate(y)) / sum((i - mx) ** 2 for i in range(n))


class PreBreakoutScanner:
    def __init__(self, rows, index_rows=None):
        self.D = [str(r[0])[:10] for r in rows]
        self.O = [float(r[1]) for r in rows]; self.H = [float(r[2]) for r in rows]; self.L = [float(r[3]) for r in rows]
        self.C = [float(r[4]) for r in rows]; self.V = [float(r[5] or 0) for r in rows]; n = self.n = len(rows)
        H, L, C, V = self.H, self.L, self.C, self.V
        self.atr = _atr(H, L, C, 14); a20 = _atr(H, L, C, 20); self.e10 = _ema(C, 10); self.e20 = _ema(C, 20)
        self.sqr = [None] * n; self.mom = [None] * n
        for i in range(19, n):
            w = C[i - 19:i + 1]; m = sum(w) / 20; sd = math.sqrt(sum((x - m) ** 2 for x in w) / 20)
            if a20[i]: self.sqr[i] = (4 * sd) / (3 * a20[i])
            mid = (max(H[i - 19:i + 1]) + min(L[i - 19:i + 1])) / 2
            self.mom[i] = C[i] - (mid + m) / 2
        obv = [0.0]
        for i in range(1, n): obv.append(obv[-1] + (V[i] if C[i] > C[i - 1] else -V[i] if C[i] < C[i - 1] else 0))
        self.obv = obv
        self.sh = [2 <= i < n - 2 and H[i] >= max(H[i - 2:i + 3]) for i in range(n)]
        self.sl = [2 <= i < n - 2 and L[i] <= min(L[i - 2:i + 3]) for i in range(n)]
        self.hasvol = sum(V[-60:]) > 0
        self.rs = None
        if index_rows:
            ix = {str(r[0])[:10]: float(r[4]) for r in index_rows}
            self.rs = [C[i] / ix[d] if ix.get(d) else None for i, d in enumerate(self.D)]

    def bar(self, i):
        """All 11 signals for bar i (needs i >= 80). Returns dict or None."""
        H, L, C, V, O, a = self.H, self.L, self.C, self.V, self.O, self.atr[i]
        if i < 80 or not a: return None
        R = max(H[i - 20:i]); rng = H[i] - L[i]
        gate = C[i] < R and R - C[i] <= 1.5 * a
        s = {}
        # 1 squeeze
        run = 0
        for j in range(i, i - 30, -1):
            if self.sqr[j] is not None and self.sqr[j] < 0.85: run += 1
            else: break
        s['squeeze'] = run >= 5 and self.mom[i] > self.mom[i - 1] and C[i] < R and (R - C[i]) / C[i] <= 0.01
        # pocket pivot (used by 2 and 7)
        dn = [V[k] for k in range(i - 10, i) if C[k] < O[k]]
        pp = self.hasvol and C[i] > O[i] and bool(dn) and V[i] > max(dn)
        # 2 vcp: pullback depths from each swing high to the next swing low (confirmed pivots only: j <= i-2)
        piv = [(j, 'h', H[j]) for j in range(i - 60, i - 1) if self.sh[j]] + [(j, 'l', L[j]) for j in range(i - 60, i - 1) if self.sl[j]]
        piv.sort(); depths = []; lasth = None
        for j, t, p in piv:
            if t == 'h': lasth = p          # depth is measured from the latest swing high before each swing low
            elif lasth: depths.append((lasth - p) / lasth); lasth = None
        inside = H[i] < H[i - 1] and L[i] > L[i - 1]
        top25 = rng > 0 and (C[i] - L[i]) / rng >= 0.75
        lowvol = self.hasvol and min(V[i - 3:i + 1]) <= min(V[i - 20:i + 1])
        s['vcp'] = len(depths) >= 3 and depths[-3] > depths[-2] > depths[-1] and lowvol and (inside or pp) and top25 and C[i] < R
        # 3 ID/NR4-NR7
        rg = [H[k] - L[k] for k in range(i - 6, i + 1)]
        s['id_nr'] = inside and (rng == min(rg) or rng == min(rg[-4:])) and gate
        # 4 ascending triangle
        hs, ls = _slope(H[i - 19:i + 1]) * 19, _slope(L[i - 19:i + 1]) * 19
        tj = [j for j in range(i - 20, i) if R - H[j] <= 0.3 * a]; touches = []
        for j in tj:
            if not touches or j - touches[-1] >= 3: touches.append(j)
        s['asc_tri'] = abs(hs) < 0.5 * a and ls > 0.5 * a and len(touches) >= 3 and C[i] < R
        # 5 shelf
        v10 = sum(V[i - 10:i]) / 10
        s['shelf'] = max(H[i - 7:i + 1]) - min(L[i - 7:i + 1]) < 1.5 * a and C[i] < R and R - C[i] <= 0.5 * a and self.hasvol and v10 > 0 and V[i] > 1.3 * v10
        # 6 spring
        lo10 = min(L[i - 10:i]); v20 = sum(V[i - 20:i]) / 20
        s['spring'] = L[i] < lo10 and C[i] > lo10 and rng > 0 and (min(O[i], C[i]) - L[i]) / rng > 0.6 and (not self.hasvol or V[i] > v20)
        # 7 pocket pivot near EMA
        s['pocket_pivot'] = pp and C[i] < R and (abs(C[i] / self.e10[i] - 1) <= 0.02 or abs(C[i] / self.e20[i] - 1) <= 0.02)
        # 8 OBV divergence
        s['obv_div'] = self.hasvol and self.obv[i] > max(self.obv[i - 25:i]) and C[i] < max(H[i - 25:i])
        # 9 VDU
        s['vdu'] = self.hasvol and v20 > 0 and V[i - 1] < 0.45 * (sum(V[i - 21:i - 1]) / 20) and C[i] > H[i - 1] and C[i] < R
        # 10 AVWAP pinch (daily approximation)
        k0 = min(range(i - 59, i + 1), key=lambda k: L[k]); pv = sum((H[k] + L[k] + C[k]) / 3 * V[k] for k in range(k0, i + 1)); vv = sum(V[k0:i + 1])
        av = pv / vv if vv else None
        s['avwap_pinch'] = av is not None and C[i] > av and C[i] < R and (R - av) <= 1.5 * a
        # 11 RS lead
        rs = self.rs
        s['rs_lead'] = bool(rs) and rs[i] is not None and all(x is not None for x in rs[i - 20:i]) and rs[i] > max(rs[i - 20:i]) and C[i] < R
        sw = [L[j] for j in range(i - 20, i - 1) if self.sl[j]]
        return dict(sig=s, count=sum(s.values()), gate=gate, R=R, atr=a, swing_low=sw[-1] if sw else min(L[i - 10:i + 1]))
