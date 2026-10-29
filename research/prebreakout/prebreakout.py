"""Pre-breakout detector: volatility compression + volume absorption under flat resistance.

Rules were fixed on 28 Oct 2026 BEFORE the first backtest run (textbook settings, no tuning):
  Resistance R  = highest high of the last 40 bars (excluding today). Needs >= 2 swing-high touches
                  within 0.5 ATR of R, at least 5 bars apart ("flat" ceiling).
  Gate          = close is below R and within 1.5 ATR(14) of it (not yet broken out).
  1 Squeeze     = Bollinger(20, 2) inside Keltner(EMA20, 1.5 x ATR20) on any of the last 3 bars   -> 0.5
                  + Bollinger width in the lowest 20% of the last 120 bars                          -> 0.5
  2 Higher lows = swing lows (2 bars each side) in the last 40 bars, the latest ones rising:
                  2 rising -> 0.5, 3+ rising -> 1.0 (only counted when the ceiling is flat)
  3 Volume      = dry-up: 10-bar avg volume < 50-bar avg, AND avg volume on down days < avg on up days
                  over the last 20 bars                                                             -> 0.5
                  + pocket pivot in the last 3 bars: green bar, range < 1 ATR, close within 1 ATR under R,
                  volume > the largest down-day volume of the prior 10 bars                         -> 0.5
  Score 0..3. Signal = gate + score >= 2.0. Strong = score >= 2.5.
Long side only (an ascending triangle is a bullish pattern). Indexes with no volume skip part 3 (max 2).
Log only: this never places, blocks or forces a trade.
"""
import math

LOOK, TOUCH_ATR, NEAR_ATR, PCT_WIN = 40, 0.5, 1.5, 120


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


def prep(rows):
    """rows = [[date, o, h, l, c, v], ...] oldest first. Returns cached series for detect()."""
    O = [float(r[1]) for r in rows]; H = [float(r[2]) for r in rows]; L = [float(r[3]) for r in rows]
    C = [float(r[4]) for r in rows]; V = [float(r[5] or 0) for r in rows]
    n = len(C); e20 = _ema(C, 20); a20 = _atr(H, L, C, 20); a14 = _atr(H, L, C, 14)
    bbw = [None] * n; sq = [False] * n
    for i in range(19, n):
        w = C[i - 19:i + 1]; m = sum(w) / 20; sd = math.sqrt(sum((x - m) ** 2 for x in w) / 20)
        bbw[i] = 4 * sd / m if m else None
        if a20[i] is not None:
            sq[i] = (m + 2 * sd < e20[i] + 1.5 * a20[i]) and (m - 2 * sd > e20[i] - 1.5 * a20[i])
    sh = [i >= 2 and i + 2 < n and H[i] >= max(H[i - 2:i + 3]) for i in range(n)]
    sl = [i >= 2 and i + 2 < n and L[i] <= min(L[i - 2:i + 3]) for i in range(n)]
    return dict(O=O, H=H, L=L, C=C, V=V, a14=a14, bbw=bbw, sq=sq, sh=sh, sl=sl, n=n, hasvol=sum(V[-60:]) > 0)


def detect(S, i):
    """Score bar i using only data up to bar i (a swing point needs 2 later bars, so only pivots <= i-2 count)."""
    H, L, C, V, O, a = S['H'], S['L'], S['C'], S['V'], S['O'], S['a14'][i]
    if i < 60 or a is None or a <= 0: return None
    R = max(H[i - LOOK:i])
    piv = [j for j in range(i - LOOK, i - 1) if S['sh'][j] and j + 2 <= i and R - H[j] <= TOUCH_ATR * a]
    touches = []
    for j in piv:
        if not touches or j - touches[-1] >= 5: touches.append(j)
    flat = len(touches) >= 2
    dist = (R - C[i]) / a
    out = dict(R=R, dist_atr=round(dist, 2), touches=len(touches), gate=0 <= dist <= NEAR_ATR and C[i] < R)
    # 1 squeeze
    s1 = 0.5 if any(S['sq'][max(0, i - 2):i + 1]) else 0
    w = [x for x in S['bbw'][max(0, i - PCT_WIN + 1):i + 1] if x is not None]
    low_vol = len(w) >= 40 and S['bbw'][i] is not None and sum(1 for x in w if x < S['bbw'][i]) <= 0.2 * len(w)
    s1 += 0.5 if low_vol else 0
    # 2 higher lows under a flat ceiling
    lows = [L[j] for j in range(i - LOOK, i - 1) if S['sl'][j]]
    rising = 1
    for k in range(len(lows) - 1, 0, -1):
        if lows[k] > lows[k - 1]: rising += 1
        else: break
    s2 = (1.0 if rising >= 3 else 0.5 if rising == 2 else 0) if flat and lows else 0
    hl = lows[-1] if lows else None
    # 3 volume dry-up + pocket pivot
    s3 = 0; pp = False
    if S['hasvol']:
        v10 = sum(V[i - 9:i + 1]) / 10; v50 = sum(V[i - 49:i + 1]) / 50
        up = [V[j] for j in range(i - 19, i + 1) if C[j] > C[j - 1]]; dn = [V[j] for j in range(i - 19, i + 1) if C[j] < C[j - 1]]
        dry = v50 > 0 and v10 < v50 and up and dn and sum(dn) / len(dn) < sum(up) / len(up)
        for j in range(i - 2, i + 1):
            prior_dn = [V[k] for k in range(j - 10, j) if C[k] < C[k - 1]]
            if C[j] > O[j] and C[j] > C[j - 1] and H[j] - L[j] < a and 0 <= R - C[j] <= a and prior_dn and V[j] > max(prior_dn):
                pp = True
        s3 = (0.5 if dry else 0) + (0.5 if pp else 0)
    score = s1 + s2 + s3
    out.update(squeeze=s1, higher_lows=s2, volume=s3, pocket_pivot=pp, score=score, swing_low=hl, atr=a,
               signal=out['gate'] and score >= 2.0, strong=out['gate'] and score >= 2.5)
    return out


def latest(rows):
    """Score the last bar of a candle list. Returns a compact dict for dashboards."""
    S = prep(rows); d = detect(S, S['n'] - 1)
    if not d: return None
    r = lambda x: None if x is None else round(x, 4 if x < 1 else 2)
    return dict(score=d['score'], signal=d['signal'], strong=d['strong'], gate=d['gate'], R=r(d['R']), dist_atr=d['dist_atr'],
                touches=d['touches'], squeeze=d['squeeze'], higher_lows=d['higher_lows'], volume=d['volume'],
                pocket_pivot=d['pocket_pivot'], swing_low=r(d['swing_low']), date=str(rows[-1][0])[:10])
