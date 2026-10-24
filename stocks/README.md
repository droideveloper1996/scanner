# Stock signal alerts (Telegram)

Same idea as the crypto scanner, for NSE stocks. Alerts only: it never places orders.

**What it sends** (HTML cards, each with Entry / Stop / T1 +1R / T2 +2R):
- 1h signal entering **Strong Buy** or **Strong Sell** (Supertrend 10/3, EMA 9/21, MACD, RSI, VWAP, ADX downgrade; closed candles only). Strong Sell cards say "avoid buying, short only through puts".
- 15m **breakout or breakdown** of the previous ~session high/low (26 candles) on at least 1.5x volume (not required for Nifty and Bank Nifty).
- **Fast move**: 2% in 1h for stocks, 0.8% for the indexes.
- 3-hour cooldown per stock and direction. The first ever run only records state and sends nothing.

**Schedule:** GitHub Actions, every 5 minutes, 09:15-15:30 IST, Monday to Friday (`.github/workflows/stock-alerts.yml`). A day with no fresh 15m candle (market holiday) sends nothing.

**Data:** Yahoo Finance chart endpoint (unofficial, free, 15m and 1h bars for SYMBOL.NS, ^NSEI, ^NSEBANK). It can lag a few minutes and has no official uptime promise. Groww's API needs keys and a fixed IP, so it is not used.

**Location:** this folder (`stocks/`) in the scanner repo; workflow is `.github/workflows/stock-alerts.yml`.

**Set up:**
1. Create a bot with @BotFather, send it /start.
2. The repo already has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for the crypto bot: to use a separate stock bot, add `STOCK_TELEGRAM_BOT_TOKEN` and `STOCK_TELEGRAM_CHAT_ID` (the workflow prefers them) (find the chat id with `npx tsx scripts/whoami.ts` after /start).
3. Optional repo variable `ALERT_STOCKS` (comma separated NSE symbols, default is the 43 names in src/universe.ts).
4. Actions tab -> stock-alerts -> Run workflow with "force" ticked to test outside market hours.

Thresholds (src/alerts.ts) are first guesses, not tuned on history.
