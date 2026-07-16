# Kalshi Terminal

A Bloomberg-terminal-style dashboard that locks onto a single Kalshi market
and streams its ticker, orderbook, and trade feed in real time.

## Architecture

- **`server/`** — Node/TypeScript backend. Holds your Kalshi API credentials
  and is the *only* thing that talks to Kalshi. It:
  - authenticates to `wss://external-api-ws.kalshi.com/trade-api/ws/v2`
    (RSA-PSS signed handshake headers),
  - subscribes to the `ticker`, `orderbook_delta`, and `trade` channels for
    whichever market is currently "locked",
  - reconstructs the live orderbook from the snapshot + delta stream,
  - re-broadcasts normalized state over a local, unauthenticated,
    loopback-only WebSocket (`ws://localhost:8787`) for the frontend to
    consume (see [Security](#security)).
- **`web/`** — Vite + React + TypeScript frontend. A dark, monospace,
  terminal-styled single page that connects to the local relay, lets you
  type a market ticker into the lock bar, and renders live price, orderbook
  depth, and a trade tape.

Your private key never leaves `server/` — the browser never sees it.

## Setup

### 1. Get a Kalshi API key

On kalshi.com: **Account & Security → API Keys → New API Key**. Choose
"auto-generate key pair". Download the private key file immediately — it's
only shown once. Note the Key ID (a UUID) shown next to it.

### 2. Configure the backend

```
cd server
cp .env.example .env
```

- Put the downloaded private key file in `server/keys/` (gitignored).
- Edit `.env`: set `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PATH`.
- `KALSHI_ENV` is `production` by default; set to `demo` to use Kalshi's demo
  environment instead.

```
npm install
npm run dev
```

You should see `Kalshi terminal relay listening on ws://localhost:8787`.

### 3. Run the frontend

```
cd web
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). Type a
market ticker (e.g. a ticker from `https://kalshi.com`, visible in a
market's URL) into the lock bar and hit **LOCK**.

## Notes

- The frontend never talks to Kalshi directly: browsers can't send the
  custom auth headers Kalshi's WS handshake requires, so the backend acts as
  an authenticated relay.
- The backend auto-reconnects (with backoff) if the upstream Kalshi
  connection drops, and re-locks onto whatever market was last selected.
- Locking onto a new market tears down the previous channel subscriptions
  and resets local orderbook/trade state.
- Ticker/orderbook/analytics updates are batched and broadcast to the
  frontend at a fixed 4Hz cadence rather than on every single upstream
  message, to keep bandwidth and render load reasonable on busy markets.
  The trade tape is pushed immediately since it's an append-only feed.

## Data collector

`collector/` is a separate long-running process for logging training data
for the v2 fair value model (see `future.md`). Unlike `server/`, which locks
onto one market for the live UI, the collector tracks the top N markets by
volume at once, writes every raw event to `collector/data/raw/`, and writes
1Hz feature snapshots plus their resolved forward-outcome labels to
`collector/data/labeled/` -- the latter is the actual training set.

### Setup

```
cd collector
cp .env.example .env
```

- Edit `.env`: set `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PATH` (can
  point at the same key file `server/` uses).
- Defaults are conservative (`COLLECTOR_MARKET_COUNT=20`,
  `COLLECTOR_MAX_RAW_LOG_GB=20`) -- see the comments in `.env.example`
  before widening them.

```
npm install
npm run build:shared
npm run dev
```

### Running unattended

This is meant to run for days/weeks on a small VM, not a laptop left open.
It fails loudly (exits 1) on any uncaught error rather than silently
hanging, so it should run under a supervisor that restarts it -- a systemd
unit template is at `deploy/kalshi-collector.service`:

```
npm run build   # from the repo root -- builds shared, server, and collector
sudo cp deploy/kalshi-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kalshi-collector
journalctl -u kalshi-collector -f
```

## Security

- The local relay (`ws://localhost:8787`) has no authentication of its own
  and is meant for a single local user. It binds to `127.0.0.1` only (not
  reachable from other machines on your network) and only accepts
  WebSocket connections from an allowlisted `Origin` header (configurable
  via `RELAY_ALLOWED_ORIGINS` in `.env`, defaults to the Vite dev server's
  origin) — without this, any web page open in the same browser could
  otherwise connect to the relay too, since WebSockets aren't subject to
  same-origin policy.
- Your Kalshi private key lives only in `server/keys/` and `server/.env`,
  both gitignored; it's read once at startup and never sent to the browser
  or logged.
- If you run this anywhere other than your own machine (a remote box, a
  container, etc.), put it behind your own auth/VPN — the relay isn't
  designed to be exposed beyond localhost.
