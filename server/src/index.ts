import { config } from "./config.js";
import { KalshiClient } from "./kalshiClient.js";
import { fetchMarketInfo } from "./marketInfo.js";
import { RelayServer } from "./relayServer.js";

const kalshi = new KalshiClient();

const relay = new RelayServer(config.port, (ticker) => {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return;
  console.log(`[lock] ${normalized}`);
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
});

kalshi.on("status", (status, detail) => {
  console.log(`[status] ${status}${detail ? ` (${detail})` : ""}`);
  relay.broadcast({ type: "status", status, upstreamError: detail });
});

kalshi.on("error", (message: string) => {
  console.error(`[kalshi error] ${message}`);
  relay.broadcast({ type: "error", message });
});

kalshi.on("ticker", (data) => relay.broadcast({ type: "ticker", data }));
kalshi.on("orderbook", (data) => relay.broadcast({ type: "orderbook", data }));
kalshi.on("trade", (data) => relay.broadcast({ type: "trade", data }));

kalshi.connect();

if (config.defaultMarketTicker) {
  kalshi.lock(config.defaultMarketTicker);
  fetchMarketInfo(config.defaultMarketTicker)
    .then((info) => relay.broadcast({ type: "locked", market: info }))
    .catch((err) => console.error(err));
}

console.log(`Kalshi terminal relay listening on ws://localhost:${config.port}`);
console.log(`Upstream: ${config.wsUrl} (${config.env})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    kalshi.close();
    process.exit(0);
  });
}
