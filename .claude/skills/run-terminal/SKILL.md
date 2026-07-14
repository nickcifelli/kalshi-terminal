---
name: run-terminal
description: Launch the Kalshi Terminal (backend relay + frontend) and open it in the browser. Use whenever the user asks to run, start, launch, or open the app/terminal/frontend for this project.
---

# Running Kalshi Terminal

Two processes, both dev servers, run concurrently. Nothing needs to be
built first — `npm run dev` in each directory is sufficient.

## Prerequisites (one-time, already done if `server/.env` exists)

- `server/.env` has `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PATH`, `KALSHI_ENV`, `PORT`.
- The private key file referenced by `KALSHI_PRIVATE_KEY_PATH` exists (e.g. `server/keys/kalshi-key.txt`).
- `npm install` has been run in both `server/` and `web/`.

If `server/.env` is missing, stop and tell the user to follow the
"Setup" section of the repo README (they need a Kalshi API key) —
don't try to fabricate credentials.

## Launch

Check ports 8787 and 5173 aren't already bound before starting new
processes (a prior run may still be alive):

```bash
lsof -i :8787 -sTCP:LISTEN
lsof -i :5173 -sTCP:LISTEN
```

If either is already listening, the app is likely already running —
just open the browser (see below) instead of starting new processes.

Otherwise, start both in the background, each in its own directory:

```bash
cd server && npm run dev   # backend relay -> ws://localhost:8787
```

```bash
cd web && npm run dev      # frontend -> http://localhost:5173
```

Run both via the Bash tool with `run_in_background: true` so they
keep running after the tool call returns. Launch them in the same
message (parallel tool calls) since they're independent.

## Verify

Read the backend's output and confirm it printed:

```
Kalshi terminal relay listening on ws://localhost:8787
[status] connected
```

Read the frontend's output and confirm Vite printed a `Local:` URL
(typically `http://localhost:5173/`).

If the backend logs a connection error instead of `[status] connected`,
the Kalshi credentials or key path are likely wrong — report that
rather than proceeding.

## Open it

```bash
open http://localhost:5173
```

This opens the frontend in the user's default browser (macOS `open`).
The app starts on a market-selection screen; the user locks onto a
specific market ticker from there.

## Stopping

Both processes were started with `run_in_background`; use TaskStop (or
just tell the user the background task IDs) if they want them killed.
