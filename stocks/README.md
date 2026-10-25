# Stock signal alerts (Telegram)

Same idea as the crypto scanner, for NSE stocks. Alerts only: it never places orders.

**What it sends** (HTML cards, each with Entry / Stop / T1 +1R / T2 +2R):
- 1h signal entering **Strong Buy** or **Strong Sell** (Supertrend 10/3, EMA 9/21, MACD, RSI, VWAP, ADX downgrade; closed candles only). Strong Sell cards say "avoid buying, short only through puts".
- 15m **breakout or breakdown** of the previous ~session high/low (26 candles) on at least 1.5x volume (not required for Nifty and Bank Nifty).
- **Fast move**: 2% in 1h for stocks, 0.8% for the indexes.
- 3-hour cooldown per stock and direction. The first ever run only records state and sends nothing.

**Personal watchlists (subscribe to a stock):** anyone who messages the bot can follow their own stocks.
- Send a stock name or symbol (`Tata Motors`, `SWIGGY`) or `/watch NAME` to subscribe; `/unwatch NAME`, `/list`, `/check NAME` (card without subscribing), `/help`. Up to 10 stocks per person, any NSE stock (names found through the universe list, then Yahoo search).
- Reply: a research card with the stance (Bullish to Bearish from up to five +1/-1 votes: price vs 200-day avg, 20 vs 50-day avg, 20-day strength vs Nifty, 1h signal, headline tone), 20-day high/low, pivots, 50-day avg, ATR, a rules-based plan, any CALL/PUT setup, and recent headlines that name the stock.
- Every trading day (first run after 08:45 IST): a digest of the person's own list (full cards for up to 3 stocks, one line each otherwise, full card when the stance changed).
- Intraday: watched stocks outside the shared universe are scanned with the same break / strong-signal rules (up to 40 extra names) and those alerts go only to their watchers. Headlines naming a watched stock go to the watcher from the news workflow.
- `/ask NAME[: question]`: the research card plus 1w/1m/3m/6m/1y returns and volume. With a question and the repo secret `ANTHROPIC_API_KEY`, Claude (default `claude-opus-5-5` at low effort, override with repo variable `ASK_MODEL`) answers from the same data pack only (prices, averages, levels, returns, stance, setup, matching headlines); it says so when the data does not cover the question (no fundamentals). Without the key, the bot answers with the matching section of the data. Max 15 Claude answers per chat per day. Roughly 2-3k input and 200-400 output tokens per question, about ₹1-2 each at Opus 5.5 list prices (Oct 2026).
- ⭐ Personal price alerts on every watched stock (universe or not), last closed 15m candle vs levels from the previous close: day move of 3%, 5% or 8% (one message at the highest step), close through the 20-day high/low, new 52-week high/low, cross of the 200-day average. Each fires once per stock per day (state key `stock-watch-triggers`), sent only to that stock's watchers.
- Messages are read by the scheduled runs (every 5 min in market hours, every 10 min 06:30-23:30 IST otherwise), so replies are not instant. State: `stock-watch` in the Actions cache. Workflow input `digest` sends all digests now.

**Reliable timing (important):** GitHub runs `schedule:` crons late or skips them (on 24-25 Oct 2026 the 10-minute news cron fired every 2-5 hours). Runs started through the API start within seconds, so use a free external cron (cron-job.org) to start them:
1. GitHub > Settings > Developer settings > Fine-grained tokens: new token, only this repo, permission **Actions: Read and write**. Keep it out of chat.
2. cron-job.org, job 1 (alerts): `POST https://api.github.com/repos/droideveloper1996/scanner/actions/workflows/stock-alerts.yml/dispatches`, every 5 minutes, Mon-Fri, 09:00-15:40 in the Asia/Kolkata timezone. Headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`. Body `{"ref":"main"}`.
3. Job 2 (news + replies to bot messages): same, with `news.yml`, every 10 minutes, every day 06:30-23:30 IST.
The `schedule:` crons stay as a fallback; extra runs are harmless (the bot-state concurrency group runs them one at a time and alerts have cooldowns).

**Schedule:** GitHub Actions, every 5 minutes, 09:15-15:30 IST, Monday to Friday (`.github/workflows/stock-alerts.yml`). A day with no fresh 15m candle (market holiday) sends nothing.

**Data:** Yahoo Finance chart endpoint (unofficial, free, 15m and 1h bars for SYMBOL.NS, ^NSEI, ^NSEBANK). It can lag a few minutes and has no official uptime promise. Groww's API needs keys and a fixed IP, so it is not used.

**Location:** this folder (`stocks/`) in the scanner repo; workflow is `.github/workflows/stock-alerts.yml`.

**Set up:**
1. Create a bot with @BotFather, send it /start.
2. The repo already has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for the crypto bot: to use a separate stock bot, add `STOCK_TELEGRAM_BOT_TOKEN` and `STOCK_TELEGRAM_CHAT_ID` (the workflow prefers them) (find the chat id with `npx tsx scripts/whoami.ts` after /start).
3. Optional repo variable `ALERT_STOCKS` (comma separated NSE symbols, default is the 43 names in src/universe.ts).
4. Actions tab -> stock-alerts -> Run workflow with "force" ticked to test outside market hours.

Thresholds (src/alerts.ts) are first guesses, not tuned on history.
