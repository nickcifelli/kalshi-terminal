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

export interface OrderbookLevel {
  priceDollars: number;
  size: number;
}

export interface OrderbookState {
  marketTicker: string;
  yes: OrderbookLevel[];
  no: OrderbookLevel[];
}

export interface TradeEvent {
  tradeId: string;
  marketTicker: string;
  yesPriceDollars: string;
  noPriceDollars: string;
  count: string;
  takerSide: string;
  tsMs: number;
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

export type ServerToClientMessage =
  | { type: "status"; status: ConnectionStatus; upstreamError?: string }
  | { type: "locked"; market: LockedMarketInfo | null }
  | { type: "ticker"; data: TickerState }
  | { type: "orderbook"; data: OrderbookState }
  | { type: "trade"; data: TradeEvent }
  | { type: "error"; message: string };

export type ClientToServerMessage = { type: "lock"; ticker: string };
