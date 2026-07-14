import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

type Env = "production" | "demo";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env: Env = (process.env.KALSHI_ENV as Env) || "production";

const hosts: Record<Env, { rest: string; ws: string }> = {
  production: {
    rest: "https://external-api.kalshi.com/trade-api/v2",
    ws: "wss://external-api-ws.kalshi.com/trade-api/ws/v2",
  },
  demo: {
    rest: "https://external-api.demo.kalshi.co/trade-api/v2",
    ws: "wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2",
  },
};

const keyId = required("KALSHI_API_KEY_ID");
const privateKeyPath = required("KALSHI_PRIVATE_KEY_PATH");
const resolvedKeyPath = path.resolve(process.cwd(), privateKeyPath);

export const config = {
  env,
  restBaseUrl: hosts[env].rest,
  wsUrl: hosts[env].ws,
  wsPath: "/trade-api/ws/v2",
  apiKeyId: keyId,
  privateKeyPem: readFileSync(resolvedKeyPath, "utf8"),

  // How many open markets to track concurrently. Start modest and watch
  // actual disk/egress usage before widening -- see future.md/plan notes on
  // the free-tier egress budget being the binding constraint, not breadth.
  marketCount: Number(process.env.COLLECTOR_MARKET_COUNT || 20),
  // How often to re-scan for newly-opened/closed markets to track.
  discoveryIntervalMs: Number(process.env.COLLECTOR_DISCOVERY_INTERVAL_MS || 20 * 60_000),
  // Feature-snapshot cadence. Deliberately not 4Hz -- 1Hz is already finer
  // than the 5s/30s/60s markout horizons need.
  snapshotIntervalMs: Number(process.env.COLLECTOR_SNAPSHOT_INTERVAL_MS || 1_000),
  // Root of the raw/ and labeled/ log trees.
  outputDir: path.resolve(process.cwd(), process.env.COLLECTOR_OUTPUT_DIR || "./data"),
  // Soft cap (GB) on the raw event log before oldest days get pruned.
  // Deliberately well under a free-tier e2-micro's 30GB disk to leave
  // headroom for the OS and the (never-pruned) labeled-snapshot log.
  maxRawLogGb: Number(process.env.COLLECTOR_MAX_RAW_LOG_GB || 20),
};
