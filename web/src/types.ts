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

export interface MarketSummary {
  ticker: string;
  title: string | null;
  subtitle: string | null;
  yesBidDollars: string | null;
  yesAskDollars: string | null;
  tradeCount: number;
  closeTime: string | null;
}

export interface MarkoutPoint {
  horizonSec: number;
  avgDollars: number | null;
  sampleCount: number;
}

export interface AnalyticsState {
  marketTicker: string;
  updatedAtMs: number;
  windowSec: number;

  spreadDollars: number | null;
  micropriceDollars: number | null;
  obiTop: number | null;
  obiDepth: number | null;
  bookSlopeBid: number | null;
  bookSlopeAsk: number | null;
  bookEntropy: number | null;

  ofi: number | null;
  quoteToTradeRatio: number | null;
  cancelToTradeRatio: number | null;

  realizedVolBps: number | null;
  amihud: number | null;
  kyleLambda: number | null;

  effectiveSpreadDollars: number | null;
  markouts: MarkoutPoint[];

  vpin: number | null;
  resiliencyMs: number | null;
  resiliencyActive: boolean;
}

export type ServerToClientMessage =
  | { type: "status"; status: ConnectionStatus; upstreamError?: string }
  | { type: "locked"; market: LockedMarketInfo | null }
  | { type: "ticker"; data: TickerState }
  | { type: "orderbook"; data: OrderbookState }
  | { type: "trade"; data: TradeEvent }
  | { type: "analytics"; data: AnalyticsState }
  | { type: "top_markets"; markets: MarketSummary[]; asOfMs: number }
  | { type: "error"; message: string };

export type ClientToServerMessage = { type: "lock"; ticker: string };
