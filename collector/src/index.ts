import { config } from "./config.js";
import { MultiMarketClient } from "./multiMarketClient.js";
import { MarketRegistry } from "./marketRegistry.js";
import { DataStore } from "./storage.js";
import { discoverTopMarkets } from "./marketDiscovery.js";

const PRUNE_INTERVAL_MS = 30 * 60_000;

const client = new MultiMarketClient();
const registry = new MarketRegistry(client);
const store = new DataStore();

client.on("status", (status: string, detail?: string) => {
  console.log(`[status] ${status}${detail ? ` (${detail})` : ""}`);
});

client.on("error", (message: string) => {
  console.error(`[kalshi error] ${message}`);
});

client.on("rawEvent", (ticker: string, type: string, payload: unknown) => {
  store.appendRawEvent(ticker, type, payload).catch((err) => console.error("[storage]", err));
});

client.connect();

async function runDiscovery(): Promise<void> {
  try {
    const tickers = await discoverTopMarkets(config.marketCount);
    console.log(`[discovery] tracking ${tickers.length} markets`);
    const previouslyTracked = new Set(registry.trackedTickers());
    client.setTrackedTickers(tickers);
    const nextTracked = new Set(tickers);
    for (const ticker of previouslyTracked) {
      if (!nextTracked.has(ticker)) registry.evict(ticker);
    }
  } catch (err) {
    console.error("[discovery] failed", err);
  }
}

runDiscovery();
const discoveryTimer = setInterval(runDiscovery, config.discoveryIntervalMs);

const tickTimer = setInterval(() => {
  const { labeled, resolved } = registry.tick();
  for (const snap of labeled) {
    store.appendLabeledSnapshot(snap).catch((err) => console.error("[storage]", err));
  }
  for (const [ticker, labels] of resolved) {
    store.appendResolvedLabels(ticker, labels).catch((err) => console.error("[storage]", err));
  }
}, config.snapshotIntervalMs);

const pruneTimer = setInterval(() => {
  store.pruneRawLogIfOverBudget().catch((err) => console.error("[storage] prune failed", err));
}, PRUNE_INTERVAL_MS);

console.log(`Kalshi collector running (${config.env}), writing to ${config.outputDir}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(discoveryTimer);
    clearInterval(tickTimer);
    clearInterval(pruneTimer);
    client.close();
    process.exit(0);
  });
}
