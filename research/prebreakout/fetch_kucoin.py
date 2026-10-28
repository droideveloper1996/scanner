"""Download ~5 years of KuCoin daily candles (public API, no key) to <out>/<SYM>.json as [[date,o,h,l,c,v], ...].
Usage: python3 fetch_kucoin.py <out_dir> [extra top coins=40]. Runs on GitHub runners (the Claude container cannot reach KuCoin)."""
import json, os, sys, time, urllib.request, datetime as dt
B = 'https://api.kucoin.com/api/v1'
DEFAULT = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LINK', 'AAVE', 'SUI', 'HYPE', 'ENA', 'PEPE', 'WIF', 'BONK', 'TRUMP']
SKIP = {'USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'USDE', 'TUSD', 'USDS', 'USD1', 'USDD', 'EUR', 'EURC', 'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH'}


def get(path):
    for k in range(3):
        try:
            j = json.load(urllib.request.urlopen(B + path, timeout=20))
            if j.get('code') == '200000': return j['data']
        except Exception as e: err = e
        time.sleep(1 + k)
    raise RuntimeError(path)


def main():
    out = sys.argv[1]; top = int(sys.argv[2]) if len(sys.argv) > 2 else 40; os.makedirs(out, exist_ok=True)
    t = get('/market/allTickers')['ticker']
    tops = sorted(((x['symbol'][:-5], float(x['volValue'] or 0)) for x in t if x['symbol'].endswith('-USDT')), key=lambda x: -x[1])
    tops = [s for s, v in tops if s not in SKIP and not s[-2:] in ('3L', '3S', '2L', '2S') and not s.endswith(('UP', 'DOWN', 'BULL', 'BEAR'))][:top]
    now = int(time.time())
    for s in dict.fromkeys(DEFAULT + tops):
        rows = {}
        for k in range(2):   # two windows of 1,000 days = ~5.5 years
            end = now - k * 1000 * 86400; start = end - 1000 * 86400
            try: d = get(f'/market/candles?type=1day&symbol={s}-USDT&startAt={start}&endAt={end}')
            except Exception: d = []
            for r in d: rows[int(r[0])] = [dt.datetime.utcfromtimestamp(int(r[0])).strftime('%Y-%m-%d'), +float(r[1]), float(r[3]), float(r[4]), float(r[2]), float(r[5])]
            time.sleep(0.3)
        today = dt.datetime.utcnow().strftime('%Y-%m-%d')
        rows = [v for k_, v in sorted(rows.items()) if v[0] < today]   # closed bars only
        if len(rows) >= 200: json.dump(rows, open(os.path.join(out, s + '.json'), 'w'))
        print(s, len(rows), rows[0][0] if rows else '-')


if __name__ == '__main__':
    main()
