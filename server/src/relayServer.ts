import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import type { ClientToServerMessage, ServerToClientMessage } from "./types.js";

const MAX_TICKER_LEN = 64;

/**
 * Local, unauthenticated WebSocket server the web frontend connects to.
 * Intentionally has no auth of its own — it never touches the Kalshi
 * private key and is meant to be run on localhost for a single user.
 *
 * Bound to 127.0.0.1 (not 0.0.0.0) so it's unreachable from other machines
 * on the network, and gated by an Origin allowlist so an arbitrary web page
 * open in the same browser can't quietly open a WebSocket to it — browsers
 * don't apply same-origin policy to WebSocket connections, so without this
 * check any tab could read the feed or send `lock` commands.
 */
export class RelayServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private lastByType = new Map<ServerToClientMessage["type"], ServerToClientMessage>();

  constructor(port: number, onLock: (ticker: string) => void) {
    this.wss = new WebSocketServer({
      port,
      host: "127.0.0.1",
      verifyClient: ({ origin }, callback) => {
        // No Origin header means the request isn't from a browser page
        // (e.g. a CLI tool or another local script), so allow it through.
        callback(!origin || config.allowedOrigins.includes(origin));
      },
    });

    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      // Replay the latest known state so a newly-opened tab isn't blank
      // until the next upstream update arrives.
      for (const msg of this.lastByType.values()) {
        socket.send(JSON.stringify(msg));
      }

      socket.on("message", (raw) => {
        let parsed: ClientToServerMessage;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (
          parsed.type === "lock" &&
          typeof parsed.ticker === "string" &&
          parsed.ticker.length <= MAX_TICKER_LEN
        ) {
          onLock(parsed.ticker);
        }
      });

      socket.on("close", () => this.clients.delete(socket));
    });
  }

  broadcast(message: ServerToClientMessage): void {
    // Ticker/orderbook/locked/status are point-in-time state; trades are an
    // append-only feed so we don't cache/replay old ones as "latest".
    if (message.type !== "trade") {
      this.lastByType.set(message.type, message);
    }
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
