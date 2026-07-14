import { config } from "./config.js";
import { KalshiClient } from "./kalshiClient.js";
import { MarketAnalytics } from "@kalshi-terminal/shared/analytics.js";
import { fetchMarketInfo, fetchMarketSummary } from "./marketInfo.js";
import { TradeCounter } from "./tradeCounter.js";
import { RelayServer } from "./relayServer.js";

const TOP_MARKETS_COUNT = 10;
const TOP_MARKETS_WARMUP_MS = 15_000;
const TOP_MARKETS_REFRESH_MS = 15_000;

const kalshi = new KalshiClient();
const analytics = new MarketAnalytics();
const tradeCounter = new TradeCounter();

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

// Ticker/orderbook can tick many times a second on a busy market; buffer the
// latest of each and flush on the same fixed cadence as analytics below
// rather than broadcasting (and forcing a frontend re-render) on every
// single upstream message.
let latestTicker: Extract<import("./types.js").ServerToClientMessage, { type: "ticker" }> | null =
  null;
let latestOrderbook:
  | Extract<import("./types.js").ServerToClientMessage, { type: "orderbook" }>
  | null = null;

kalshi.on("ticker", (data) => {
  latestTicker = { type: "ticker", data };
});

kalshi.on("orderbook", (data) => {
  latestOrderbook = { type: "orderbook", data };
  analytics.onOrderbook(data);
});

kalshi.on("bookEvent", (kind: "snapshot" | "delta", deltaFp?: number) => {
  analytics.onBookEvent(kind, deltaFp);
});

kalshi.on("trade", (data) => {
  relay.broadcast({ type: "trade", data });
  analytics.onTrade(data);
});

kalshi.on("tradeSeen", (ticker: string) => tradeCounter.record(ticker));

kalshi.connect();

console.log(`Kalshi terminal relay listening on ws://localhost:${config.port}`);
console.log(`Upstream: ${config.wsUrl} (${config.env})`);

// Ticker/orderbook/analytics are all cheap to recompute but expensive to
// ship on every single upstream message; batch broadcasts onto a fixed
// cadence instead.
const broadcastTimer = setInterval(() => {
  if (latestTicker) {
    relay.broadcast(latestTicker);
    latestTicker = null;
  }
  if (latestOrderbook) {
    relay.broadcast(latestOrderbook);
    latestOrderbook = null;
  }
  if (analytics.consumeDirty()) {
    const snapshot = analytics.snapshot();
    if (snapshot) relay.broadcast({ type: "analytics", data: snapshot });
  }
}, 250);

// Ranks the top markets by live trade count (seen over the global WS trade
// feed — see kalshiClient's subscribeGlobalTrades) for the market-selection
// screen. Held back for TOP_MARKETS_WARMUP_MS so the first broadcast isn't
// based on just one or two early trades.
async function refreshTopMarkets(): Promise<void> {
  const ranked = tradeCounter.topTickers(TOP_MARKETS_COUNT);
  const enriched = await Promise.all(
    ranked.map(async ({ ticker, tradeCount }) => {
      const meta = await fetchMarketSummary(ticker);
      return meta && { ...meta, tradeCount };
    }),
  );
  const markets = enriched.filter((m): m is NonNullable<typeof m> => m != null);
  console.log(`[top-markets] refreshed (${markets.length} ranked)`);
  relay.broadcast({ type: "top_markets", markets, asOfMs: Date.now() });
}

const topMarketsWarmupTimer = setTimeout(() => {
  refreshTopMarkets();
  topMarketsTimer = setInterval(refreshTopMarkets, TOP_MARKETS_REFRESH_MS);
}, TOP_MARKETS_WARMUP_MS);
let topMarketsTimer: NodeJS.Timeout | undefined;

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(broadcastTimer);
    clearTimeout(topMarketsWarmupTimer);
    clearInterval(topMarketsTimer);
    kalshi.close();
    process.exit(0);
  });
}
