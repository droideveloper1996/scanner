# Crypto Signal Scanner (Next.js)

Live buy/sell signals for meme, DeFi and major crypto from Crypto.com Exchange public market data, plus
alerts that run on a server schedule and message you on Telegram. Read-only: it cannot place orders.
Not investment advice.

- **Scanner page**: categories, 15m/1h/4h/1D, signal filter, chart with Supertrend, EMAs, RSI, MACD. Installable as a PWA.
- **Signals**: five votes (Supertrend 10/3, EMA 9 vs 21, MACD histogram, RSI 14, price vs VWAP or 50-candle average); ADX under 20 downgrades "Strong".
- **Alerts** (`/api/cron/alerts`), closed candles only:
  - a coin **enters Strong Buy or Strong Sell** on 1h candles (alerts once per change, not every run);
  - a **15m breakout** past the 8h high or low on 1.5x volume, or a fast 1h move (2.5% BTC/ETH, 4% others), with a 4h cooldown per coin and direction.
  - The first run only records the current state and sends nothing, so you are not flooded.

## 1. Run locally

    npm install
    cp .env.example .env.local     # fill it in
    npm run dev                    # http://localhost:3000

## 2. Telegram

1. Create a bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`. Keep it out of git and chat.
2. Send any message to your bot, then call (with your `CRON_SECRET`):

       curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/alerts?whoami=1"

   Copy your chat `id` into `TELEGRAM_CHAT_ID`.
3. Test it: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/alerts?test=1"`

## 3. Alerts every 15 minutes (GitHub Actions, no server)

1. Push this folder to a private GitHub repo.
2. Repo Settings > Secrets and variables > Actions: add secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
   Optional variable `ALERT_COINS` (comma list) changes the watched coins.
3. Actions tab > crypto-alerts > Run workflow once. The first run only records the current state and sends nothing.
   After that it runs on the schedule in the workflow (`.github/workflows/alerts.yml`, runner `scripts/run-alerts.ts`).

Each run also steps the **pump sleeve** of the crypto paper book ($300 of the $1,200, paper only, rules in `src/lib/pumpbook.ts`):
it buys fresh upside 15m breakouts (stop 0.5% under the broken 8h high, breakeven at +1R, target 2R, 24h time stop,
$150 max, $18 risk, max 2 open), messages Telegram on every paper buy/exit, and commits `paper/pump-book.json` when it changes.
`paper-crypto/pump_sync.py` in the project merges that file into the main book's state.json.

Actions minutes: each run bills about 1 minute. Private repos get 2,000 free minutes a month (enough for every 30 minutes);
public repos are free without limit.

GitHub can start scheduled runs a few minutes late and pauses them after 60 days without repo activity.
For exact timing, deploy the app (below) and call it from cron-job.org instead.

## 4. Deploy the page (Vercel, optional)

1. Import the repo in Vercel.
2. Add `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and an **Upstash Redis** database
   (Vercel Marketplace, free tier) which sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   Alert state must persist between runs, and Vercel has no writable disk.
3. To alert from the deployed app instead of Actions, have cron-job.org call
   `POST $APP_URL/api/cron/alerts` with `Authorization: Bearer $CRON_SECRET` every 15 minutes, and disable the Actions workflow
   so the two don't both send.

Self-hosting on a VPS or Docker works too: leave the Upstash variables empty and alert state is kept in `.data/`.
Call `POST /api/cron/alerts` from system cron every 15 minutes.

## Endpoints

| Path | Purpose |
|---|---|
| `GET /api/candles?sym=DOGE&tf=1h&count=120` | candles for the page |
| `GET /api/tickers` | prices and 24h change for the page |
| `GET /api/alerts` | recent alerts and setup status for the page (read-only, public) |
| `POST /api/cron/alerts` | run the checks. Needs `Authorization: Bearer $CRON_SECRET`. `?dry=1` sends and saves nothing. |

## Notes
- Telegram: alerts go to TELEGRAM_CHAT_ID plus every subscriber. Anyone who messages the bot (e.g. /start) is subscribed on the next run; /stop unsubscribes. The list lives in alert state, never in the repo or logs.
- Coins watched: the 14 defaults plus the top 100 coins by 24h USD volume on Crypto.com (stablecoins and wrapped tokens left out), refreshed every run. Repo variable `ALERT_TOP` changes 100; `ALERT_COINS` (comma list) replaces all of this with a fixed list. A coin new to the list only records its signal on its first run, so it does not alert on arrival. Coins you add in the page stay in your browser and are not alerted.
- The alert check fetches 300 hourly candles per coin. Indicators such as ADX shift with short histories, so keep it at 300.
- `/api/alerts` shows recent alert text to anyone with the URL. Keep the deployment private if that matters.
