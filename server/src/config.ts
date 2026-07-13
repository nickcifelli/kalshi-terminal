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
  port: Number(process.env.PORT || 8787),
  // Origins allowed to open a WebSocket connection to the local relay (see
  // relayServer.ts). Defaults cover the Vite dev server on its default port.
  allowedOrigins: (
    process.env.RELAY_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
