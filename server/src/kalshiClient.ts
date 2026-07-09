import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { config } from "./config.js";
import { buildAuthHeaders } from "./kalshiSign.js";
import type {
  ConnectionStatus,
  OrderbookLevel,
  OrderbookState,
  TickerState,
  TradeEvent,
} from "./types.js";

const CHANNELS = ["ticker", "orderbook_delta", "trade"] as const;
const HEARTBEAT_TIMEOUT_MS = 15_000; // server pings every 10s; bail if we miss it
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

interface SubscribedChannel {
  channel: (typeof CHANNELS)[number];
  sid: number;
}

/**
 * Maintains a single authenticated connection to Kalshi's market data
 * WebSocket and exposes a "lock onto one market" API: call lock(ticker) to
 * (re)subscribe the ticker/orderbook_delta/trade channels to a new market,
 * tearing down the previous subscriptions first.
 */
export class KalshiClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private nextCmdId = 1;
  private lockedTicker: string | null = null;
  private subscriptions: SubscribedChannel[] = [];
  private orderbook: { yes: Map<number, number>; no: Map<number, number> } = {
    yes: new Map(),
    no: new Map(),
  };
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

  /** Switch the live subscriptions over to a new market ticker. */
  lock(ticker: string): void {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) return;
    this.lockedTicker = normalized;
    this.orderbook = { yes: new Map(), no: new Map() };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.resubscribe(normalized);
    }
    // If not connected yet, openSocket()'s "open" handler will subscribe
    // once the connection is established.
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const headers = buildAuthHeaders(
      config.privateKeyPem,
      config.apiKeyId,
      "GET",
      config.wsPath,
    );
    const ws = new WebSocket(config.wsUrl, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.armHeartbeatWatchdog();
      if (this.lockedTicker) {
        this.resubscribe(this.lockedTicker);
      }
    });

    ws.on("ping", () => {
      this.armHeartbeatWatchdog();
      // the `ws` library auto-responds with pong; nothing else to do
    });

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
      // No ping/message from the server within the expected window; treat
      // the connection as dead and force a reconnect.
      this.ws?.terminate();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeatWatchdog(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resubscribe(ticker: string): void {
    const staleSids = this.subscriptions.map((s) => s.sid);
    this.subscriptions = [];
    if (staleSids.length > 0) {
      this.send({
        id: this.nextCmdId++,
        cmd: "unsubscribe",
        params: { sids: staleSids },
      });
    }
    this.send({
      id: this.nextCmdId++,
      cmd: "subscribe",
      params: {
        channels: [...CHANNELS],
        market_ticker: ticker,
      },
    });
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.emit("status", status, detail);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

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
        this.emit("ticker", this.parseTicker(msg.msg));
        return;
      }
      case "orderbook_snapshot": {
        this.applySnapshot(msg.msg);
        this.emit("orderbook", this.currentOrderbook(msg.msg.market_ticker));
        return;
      }
      case "orderbook_delta": {
        this.applyDelta(msg.msg);
        this.emit("orderbook", this.currentOrderbook(msg.msg.market_ticker));
        return;
      }
      case "trade": {
        this.emit("trade", this.parseTrade(msg.msg));
        return;
      }
      default:
        return;
    }
  }

  private parseTicker(m: any): TickerState {
    return {
      marketTicker: m.market_ticker,
      priceDollars: m.price_dollars ?? null,
      yesBidDollars: m.yes_bid_dollars ?? null,
      yesAskDollars: m.yes_ask_dollars ?? null,
      volume: m.volume_fp ?? null,
      openInterest: m.open_interest_fp ?? null,
      lastTradeSize: m.last_trade_size_fp ?? null,
      tsMs: m.ts_ms ?? null,
    };
  }

  private parseTrade(m: any): TradeEvent {
    return {
      tradeId: m.trade_id,
      marketTicker: m.market_ticker,
      yesPriceDollars: m.yes_price_dollars,
      noPriceDollars: m.no_price_dollars,
      count: m.count_fp,
      takerSide: m.taker_side,
      tsMs: m.ts_ms ?? (m.ts ? m.ts * 1000 : Date.now()),
    };
  }

  private applySnapshot(m: any): void {
    this.orderbook.yes = new Map(
      (m.yes_dollars_fp ?? []).map(([price, size]: [number, number]) => [
        Number(price),
        Number(size),
      ]),
    );
    this.orderbook.no = new Map(
      (m.no_dollars_fp ?? []).map(([price, size]: [number, number]) => [
        Number(price),
        Number(size),
      ]),
    );
  }

  private applyDelta(m: any): void {
    const book = m.side === "no" ? this.orderbook.no : this.orderbook.yes;
    const price = Number(m.price_dollars);
    const delta = Number(m.delta_fp);
    const nextSize = (book.get(price) ?? 0) + delta;
    if (nextSize <= 0) {
      book.delete(price);
    } else {
      book.set(price, nextSize);
    }
  }

  private currentOrderbook(marketTicker: string): OrderbookState {
    const toLevels = (map: Map<number, number>): OrderbookLevel[] =>
      [...map.entries()]
        .map(([priceDollars, size]) => ({ priceDollars, size }))
        .sort((a, b) => b.priceDollars - a.priceDollars);
    return {
      marketTicker,
      yes: toLevels(this.orderbook.yes),
      no: toLevels(this.orderbook.no),
    };
  }
}
