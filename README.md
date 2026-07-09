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
  - re-broadcasts normalized state over a local, unauthenticated WebSocket
    (`ws://localhost:8787`) for the frontend to consume.
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
