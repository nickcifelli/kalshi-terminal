import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { buildAuthHeaders } from "@kalshi-terminal/shared/kalshiSign.js";
import type { OrderbookState, TradeEvent } from "@kalshi-terminal/shared/types.js";
import { config } from "./config.js";

const CHANNELS = ["ticker", "orderbook_delta", "trade"] as const;

// Same crossed-book-from-float-drift bug server/kalshiClient.ts's SIZE_SCALE
// trick fixes applies identically here -- resting sizes are accumulated as
// scaled integers, not floats, so repeated delta application can't drift a
// depleted level off exact zero.
const SIZE_SCALE = 100;

function toScaledSize(raw: unknown): number {
  return Math.round(Number(raw) * SIZE_SCALE);
}

const HEARTBEAT_TIMEOUT_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

interface SubscribedChannel {
  channel: string;
  sid: number;
}

type OrderbookMaps = { yes: Map<number, number>; no: Map<number, number> };

/**
 * Multi-market Kalshi WS client: one connection subscribed to many tickers
 * at once via the `market_tickers` array (confirmed on ticker/
 * orderbook_delta/trade), with incremental add/remove through
 * update_subscription as the tracked set changes over time.
 *
 * Deliberately not a reuse/generalization of server/kalshiClient.ts:
 * that client is shaped around "lock onto exactly one market, tearing down
 * and resubscribing on relock." Tracking an open-ended, changing set of N
 * tickers is a different enough shape that bending the single-lock client
 * to fit would cost more clarity than it saves. What *is* copied
 * deliberately from it: the reconnect/heartbeat-watchdog logic and the
 * scaled-integer orderbook accumulation above -- that's where correctness,
 * not shape, is what matters.
 */
export class MultiMarketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private nextCmdId = 1;
  private trackedTickers = new Set<string>();
  private subscriptions: SubscribedChannel[] = [];
  private orderbooks = new Map<string, OrderbookMaps>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closedByUser = false;

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeatWatchdog();
    this.ws?.close();
  }

  /** Diffs against the currently-tracked set. If a subscription already
   * exists, adds/removes tickers incrementally via update_subscription;
   * otherwise (nothing subscribed yet -- e.g. the WS connected before the
   * first discovery scan resolved) sends a fresh subscribe once tickers are
   * available, since there's no existing sid to target an update at. */
  setTrackedTickers(tickers: string[]): void {
    const next = new Set(tickers);
    const added = [...next].filter((t) => !this.trackedTickers.has(t));
    const removed = [...this.trackedTickers].filter((t) => !next.has(t));
    this.trackedTickers = next;

    for (const ticker of removed) this.orderbooks.delete(ticker);

    if (this.ws?.readyState !== WebSocket.OPEN) return; // openSocket() subscribes fresh once connected

    if (this.subscriptions.length === 0) {
      if (next.size > 0) this.sendInitialSubscribe();
      return;
    }
    if (added.length > 0) this.updateSubscription("add_markets", added);
    if (removed.length > 0) this.updateSubscription("delete_markets", removed);
  }

  private sendInitialSubscribe(): void {
    const payload = {
      id: this.nextCmdId++,
      cmd: "subscribe",
      params: { channels: [...CHANNELS], market_tickers: [...this.trackedTickers] },
    };
    if (process.env.COLLECTOR_DEBUG_WS) console.log("[ws-debug] sending", JSON.stringify(payload));
    this.send(payload);
  }

  private updateSubscription(action: "add_markets" | "delete_markets", tickers: string[]): void {
    for (const { sid } of this.subscriptions) {
      this.send({
        id: this.nextCmdId++,
        cmd: "update_subscription",
        params: { sids: [sid], market_tickers: tickers, action },
      });
    }
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const headers = buildAuthHeaders(config.privateKeyPem, config.apiKeyId, "GET", config.wsPath);
    const ws = new WebSocket(config.wsUrl, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.armHeartbeatWatchdog();
      this.subscriptions = [];
      if (this.trackedTickers.size > 0) this.sendInitialSubscribe();
    });

    ws.on("ping", () => this.armHeartbeatWatchdog());
    ws.on("pong", () => this.armHeartbeatWatchdog());

    ws.on("message", (raw) => {
      this.armHeartbeatWatchdog();
      this.handleMessage(raw.toString());
    });

    ws.on("error", (err) => {
      this.emit("error", err instanceof Error ? err.message : String(err));
    });

    ws.on("close", (code, reason) => {
      this.clearHeartbeatWatchdog();
      this.subscriptions = [];
      if (this.closedByUser) {
        this.setStatus("disconnected");
        return;
      }
      this.setStatus("reconnecting", `closed (${code}) ${reason.toString()}`.trim());
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private armHeartbeatWatchdog(): void {
    this.clearHeartbeatWatchdog();
    this.heartbeatTimer = setTimeout(() => {
      this.ws?.terminate();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: string, detail?: string): void {
    this.emit("status", status, detail);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (process.env.COLLECTOR_DEBUG_WS) console.log("[ws-debug]", JSON.stringify(msg).slice(0, 300));

    switch (msg.type) {
      case "subscribed": {
        this.subscriptions.push({ channel: msg.msg.channel, sid: msg.msg.sid });
        return;
      }
      case "error": {
        this.emit("error", `Kalshi WS error ${msg.msg?.code}: ${msg.msg?.msg}`);
        return;
      }
      case "ticker": {
        const ticker = msg.msg.market_ticker;
        if (this.trackedTickers.has(ticker)) this.emit("rawEvent", ticker, "ticker", msg.msg);
        return;
      }
      case "orderbook_snapshot": {
        const ticker = msg.msg.market_ticker;
        if (!this.trackedTickers.has(ticker)) return;
        this.applySnapshot(ticker, msg.msg);
        this.emit("orderbook", ticker, this.currentOrderbook(ticker));
        this.emit("bookEvent", ticker, "snapshot", undefined);
        this.emit("rawEvent", ticker, "orderbook_snapshot", msg.msg);
        return;
      }
      case "orderbook_delta": {
        const ticker = msg.msg.market_ticker;
        if (!this.trackedTickers.has(ticker)) return;
        this.applyDelta(ticker, msg.msg);
        this.emit("orderbook", ticker, this.currentOrderbook(ticker));
        this.emit("bookEvent", ticker, "delta", Number(msg.msg.delta_fp));
        this.emit("rawEvent", ticker, "orderbook_delta", msg.msg);
        return;
      }
      case "trade": {
        const ticker = msg.msg.market_ticker;
        if (!this.trackedTickers.has(ticker)) return;
        const trade: TradeEvent = {
          tradeId: msg.msg.trade_id,
          marketTicker: ticker,
          yesPriceDollars: msg.msg.yes_price_dollars,
          noPriceDollars: msg.msg.no_price_dollars,
          count: msg.msg.count_fp,
          takerSide: msg.msg.taker_side,
          tsMs: msg.msg.ts_ms ?? (msg.msg.ts ? msg.msg.ts * 1000 : Date.now()),
        };
        this.emit("trade", ticker, trade);
        this.emit("rawEvent", ticker, "trade", msg.msg);
        return;
      }
      default:
        return;
    }
  }

  private applySnapshot(ticker: string, m: any): void {
    this.orderbooks.set(ticker, {
      yes: new Map(
        (m.yes_dollars_fp ?? []).map(([price, size]: [number, number]) => [
          Number(price),
          toScaledSize(size),
        ]),
      ),
      no: new Map(
        (m.no_dollars_fp ?? []).map(([price, size]: [number, number]) => [
          Number(price),
          toScaledSize(size),
        ]),
      ),
    });
  }

  private applyDelta(ticker: string, m: any): void {
    let book = this.orderbooks.get(ticker);
    if (!book) {
      book = { yes: new Map(), no: new Map() };
      this.orderbooks.set(ticker, book);
    }
    const side = m.side === "no" ? book.no : book.yes;
    const price = Number(m.price_dollars);
    const delta = toScaledSize(m.delta_fp);
    const nextSize = (side.get(price) ?? 0) + delta;
    if (nextSize <= 0) side.delete(price);
    else side.set(price, nextSize);
  }

  private currentOrderbook(ticker: string): OrderbookState {
    const book = this.orderbooks.get(ticker) ?? { yes: new Map(), no: new Map() };
    const toLevels = (map: Map<number, number>) =>
      [...map.entries()]
        .map(([priceDollars, size]) => ({ priceDollars, size: size / SIZE_SCALE }))
        .sort((a, b) => b.priceDollars - a.priceDollars);
    return { marketTicker: ticker, yes: toLevels(book.yes), no: toLevels(book.no) };
  }
}
