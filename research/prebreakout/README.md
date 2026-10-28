# Pre-breakout detector (research, log only)

Same Python files as the PersonalFinance project folder `prebreakout/`. The rules are in the `prebreakout.py` docstring and were fixed before any test was run.

- `prebreakout.py`: detector (squeeze, higher lows under flat resistance, volume dry-up + pocket pivot; score 0-3, signal at >= 2).
- `bt_prebreakout.py`: event study vs a "near resistance" baseline, in-sample before 2024-10-11, out-of-sample after.
- `fetch_kucoin.py`: ~5 years of KuCoin daily candles (14 default coins + top 40 by volume).

Run the crypto test: Actions -> crypto-alerts -> Run workflow, tick `prebreakout`. It prints results only and sends nothing.
This is not wired into alerts or any paper/real trading.

`features.py` (PreBreakoutScanner) computes 11 pre-breakout signals (TTM squeeze, VCP, ID/NR4-7, ascending triangle, shelf, spring, pocket pivot, OBV divergence, volume dry-up, anchored-VWAP pinch, RS lead); `bt_features.py` tests each one alone. Both run in the same `prebreakout` workflow input.
