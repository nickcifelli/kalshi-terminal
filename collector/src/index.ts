import { config } from "./config.js";
import { MultiMarketClient } from "./multiMarketClient.js";
import { MarketRegistry } from "./marketRegistry.js";
import { DataStore } from "./storage.js";
import { discoverTopMarkets } from "./marketDiscovery.js";
import { MAX_MARKOUT_WAIT_MS } from "@kalshi-terminal/shared/analytics.js";

const PRUNE_INTERVAL_MS = 30 * 60_000;

// A ticker falling out of the discovered top-N still has up to
// MAX_MARKOUT_WAIT_MS worth of taken-but-unresolved labeled snapshots. If we
// unsubscribed/evicted it immediately, those would never see another
// orderbook/trade update and their labels would go permanently unresolved --
// silently corrupting the training set with orphaned snapshot rows. Instead,
// keep it subscribed and tracked for a grace period past MAX_MARKOUT_WAIT_MS
// so pending labels get a chance to resolve before we actually let it go.
const EVICTION_GRACE_MS = MAX_MARKOUT_WAIT_MS + 15_000;

const client = new MultiMarketClient();
const registry = new MarketRegistry(client);
const store = new DataStore();

let discoveredTickers = new Set<string>();
const pendingEviction = new Map<string, number>(); // ticker -> evictAtMs

let discoveryTimer: NodeJS.Timeout | undefined;
let tickTimer: NodeJS.Timeout | undefined;
let pruneTimer: NodeJS.Timeout | undefined;

function desiredSubscribeSet(): string[] {
  return [...new Set([...discoveredTickers, ...pendingEviction.keys()])];
}

function shutdown(exitCode: number): void {
  if (discoveryTimer) clearInterval(discoveryTimer);
  if (tickTimer) clearInterval(tickTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  client.close();
  process.exit(exitCode);
}

// This process is meant to run unattended for weeks. A left-running process
// stuck after an uncaught error is worse than a crash: data collection would
// silently stall with nothing telling anyone to look. Fail loud and exit
// instead, so a process supervisor (systemd Restart=always -- see
// deploy/kalshi-collector.service) restarts collection right away.
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", err);
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
  shutdown(1);
});

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
    const nextTracked = new Set(tickers);
    const now = Date.now();

    // Reappeared before its grace period expired -- cancel the eviction.
    for (const ticker of nextTracked) pendingEviction.delete(ticker);

    // Freshly dropped out of the top-N: start its grace period rather than
    // evicting immediately (see EVICTION_GRACE_MS above).
    for (const ticker of discoveredTickers) {
      if (!nextTracked.has(ticker) && !pendingEviction.has(ticker)) {
        pendingEviction.set(ticker, now + EVICTION_GRACE_MS);
      }
    }

    discoveredTickers = nextTracked;
    client.setTrackedTickers(desiredSubscribeSet());
  } catch (err) {
    console.error("[discovery] failed", err);
  }
}

runDiscovery();
discoveryTimer = setInterval(runDiscovery, config.discoveryIntervalMs);

tickTimer = setInterval(() => {
  const { labeled, resolved } = registry.tick();
  for (const snap of labeled) {
    store.appendLabeledSnapshot(snap).catch((err) => console.error("[storage]", err));
  }
  for (const [ticker, labels] of resolved) {
    store.appendResolvedLabels(ticker, labels).catch((err) => console.error("[storage]", err));
  }

  const now = Date.now();
  let graceExpired = false;
  for (const [ticker, evictAtMs] of pendingEviction) {
    if (now >= evictAtMs) {
      pendingEviction.delete(ticker);
      registry.evict(ticker);
      graceExpired = true;
    }
  }
  if (graceExpired) client.setTrackedTickers(desiredSubscribeSet());
}, config.snapshotIntervalMs);

pruneTimer = setInterval(() => {
  store.pruneRawLogIfOverBudget().catch((err) => console.error("[storage] prune failed", err));
}, PRUNE_INTERVAL_MS);

console.log(`Kalshi collector running (${config.env}), writing to ${config.outputDir}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => shutdown(0));
}
