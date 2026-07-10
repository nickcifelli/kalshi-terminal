import { config } from "./config.js";
import { KalshiClient } from "./kalshiClient.js";
import { MarketAnalytics } from "./analytics.js";
import { fetchMarketInfo } from "./marketInfo.js";
import { RelayServer } from "./relayServer.js";

const kalshi = new KalshiClient();
const analytics = new MarketAnalytics();

function lockMarket(ticker: string): void {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return;
  console.log(`[lock] ${normalized}`);
  analytics.reset(normalized);
  kalshi.lock(normalized);
  fetchMarketInfo(normalized)
    .then((info) => relay.broadcast({ type: "locked", market: info }))
    .catch((err) => {
      console.error(err);
      relay.broadcast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

const relay = new RelayServer(config.port, lockMarket);

kalshi.on("status", (status, detail) => {
  console.log(`[status] ${status}${detail ? ` (${detail})` : ""}`);
  relay.broadcast({ type: "status", status, upstreamError: detail });
});

kalshi.on("error", (message: string) => {
  console.error(`[kalshi error] ${message}`);
  relay.broadcast({ type: "error", message });
});

kalshi.on("ticker", (data) => relay.broadcast({ type: "ticker", data }));

kalshi.on("orderbook", (data) => {
  relay.broadcast({ type: "orderbook", data });
  analytics.onOrderbook(data);
});

kalshi.on("bookEvent", (kind: "snapshot" | "delta", deltaFp?: number) => {
  analytics.onBookEvent(kind, deltaFp);
});

kalshi.on("trade", (data) => {
  relay.broadcast({ type: "trade", data });
  analytics.onTrade(data);
});

kalshi.connect();

if (config.defaultMarketTicker) {
  lockMarket(config.defaultMarketTicker);
}

console.log(`Kalshi terminal relay listening on ws://localhost:${config.port}`);
console.log(`Upstream: ${config.wsUrl} (${config.env})`);

// Analytics are cheap to recompute but expensive to ship on every single
// book delta; batch snapshots onto a fixed cadence instead.
const analyticsBroadcastTimer = setInterval(() => {
  if (!analytics.consumeDirty()) return;
  const snapshot = analytics.snapshot();
  if (snapshot) relay.broadcast({ type: "analytics", data: snapshot });
}, 250);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(analyticsBroadcastTimer);
    kalshi.close();
    process.exit(0);
  });
}
