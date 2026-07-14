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

export interface MarkoutPoint {
  horizonSec: number;
  avgDollars: number | null;
  sampleCount: number;
}

/** Rolling-window microstructure analytics computed server-side from the live book/trade stream. */
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

  realizedVolLogit: number | null;
  amihudLogit: number | null;
  kyleLambda: number | null;

  effectiveSpreadDollars: number | null;
  markouts: MarkoutPoint[];

  vpin: number | null;
  resiliencyMs: number | null;
  resiliencyActive: boolean;

  /** Order-flow-adjusted fair value estimate (v1, non-ML) -- see future.md for the planned v2. */
  fairValueDollars: number | null;
  fairValueEdgeDollars: number | null;
  fvBeta: number | null;
  fvConfidence: number | null;
  fvHitRate: number | null;
  fvSampleCount: number;
}
