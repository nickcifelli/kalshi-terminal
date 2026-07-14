import type {
  OrderbookLevel,
  OrderbookState,
  TradeEvent,
  MarkoutPoint,
  AnalyticsState,
} from "@kalshi-terminal/shared/types.js";

export type { OrderbookLevel, OrderbookState, TradeEvent, MarkoutPoint, AnalyticsState };

export interface TickerState {
  marketTicker: string;
  priceDollars: string | null;
  yesBidDollars: string | null;
  yesAskDollars: string | null;
  volume: string | null;
  openInterest: string | null;
  lastTradeSize: string | null;
  tsMs: number | null;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

export interface LockedMarketInfo {
  ticker: string;
  title: string | null;
  subtitle: string | null;
  status: string | null;
  closeTime: string | null;
}

/** Summary of an open market, ranked by live trade count for the
 * market-selection screen. */
export interface MarketSummary {
  ticker: string;
  title: string | null;
  subtitle: string | null;
  yesBidDollars: string | null;
  yesAskDollars: string | null;
  tradeCount: number;
  closeTime: string | null;
}

/** Messages the backend relay sends down to the web frontend. */
export type ServerToClientMessage =
  | { type: "status"; status: ConnectionStatus; upstreamError?: string }
  | { type: "locked"; market: LockedMarketInfo | null }
  | { type: "ticker"; data: TickerState }
  | { type: "orderbook"; data: OrderbookState }
  | { type: "trade"; data: TradeEvent }
  | { type: "analytics"; data: AnalyticsState }
  | { type: "top_markets"; markets: MarketSummary[]; asOfMs: number }
  | { type: "error"; message: string };

/** Messages the web frontend sends up to the backend relay. */
export type ClientToServerMessage = { type: "lock"; ticker: string };
