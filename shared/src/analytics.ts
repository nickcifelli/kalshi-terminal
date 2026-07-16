import type { AnalyticsState, MarkoutPoint, OrderbookState, TradeEvent } from "./types.js";

// Rolling window used for all time-pruned stats (spread/vol/OFI/ratios/etc).
const WINDOW_MS = 5 * 60_000;

// How many resting levels per side feed depth/entropy/slope calculations.
const DEPTH_LEVELS = 10;
const SLOPE_LEVELS = 5;

// Multi-horizon markout / realized-spread tracking.
const MARKOUT_HORIZONS_SEC = [5, 30, 60];
// Exported so callers that stop feeding a market (e.g. the collector
// evicting a ticker that fell out of the tracked top-N) know how long to
// keep it alive/subscribed before any still-pending labels are guaranteed
// to have either resolved or been given up on.
export const MAX_MARKOUT_WAIT_MS = 75_000;

// Kyle's lambda: time-bucketed signed-flow vs mid-change regression.
const KYLE_INTERVAL_MS = 10_000;
const KYLE_MAX_INTERVALS = 30;

// VPIN: fixed-size rolling window of volume buckets.
const VPIN_BUCKET_COUNT = 50;
const VPIN_MIN_TRADES_FOR_TARGET = 20;
const VPIN_BUCKET_MULTIPLE = 50;
const VPIN_MIN_BUCKET_SIZE = 20;

// Resiliency: spread-shock detection off a slow trailing baseline.
const SPREAD_EMA_ALPHA = 0.02;
const SHOCK_MULT = 1.75;
const RECOVER_MULT = 1.1;

// Fair value: online order-flow-adjusted estimator, no training. A rolling
// through-origin regression of forward logit(mid) drift on smoothed OFI,
// refit continuously and scored against its own causal directional hit rate
// -- same shape as Kyle's lambda above, but forward-looking (predict, wait,
// resolve) like markouts rather than contemporaneous. See ../../future.md
// for the planned trained/ensemble v2.
const FV_OFI_EMA_ALPHA = 0.2;
const FV_HORIZON_SEC = MARKOUT_HORIZONS_SEC[0];
const FV_SAMPLE_INTERVAL_MS = 1_000;
const FV_MAX_CALIBRATION_SAMPLES = 300;
const FV_MIN_CALIBRATION_SAMPLES = 30;
const FV_MAX_PENDING_WAIT_MS = (FV_HORIZON_SEC + 15) * 1000;
// Regime gate: collapse the adjustment toward raw mid when flow looks toxic
// (VPIN) or the book is mid-shock -- i.e. trust the signal less exactly when
// it's noisiest, rather than blending it in at a fixed weight always.
const FV_SHOCK_CONFIDENCE = 0.15;

// Kalshi prices are probabilities bounded in [0, 1], not compounding asset
// prices -- log(cur/prev) returns blow up near the boundaries (a 1c->2c move
// registers as a huge "return" despite trivial P&L impact) and understate
// moves near 50c. The logit/log-odds transform is unbounded and symmetric,
// so differencing it gives a "return" that scales correctly across the
// whole price range. Clamp away from the boundary so a 0/100c quote doesn't
// produce +/-Infinity.
const LOGIT_EPS = 1e-4;

function logit(p: number): number {
  const clamped = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface PriceSize {
  price: number;
  size: number;
}

interface MidSample {
  tsMs: number;
  mid: number;
}

interface WindowedNumber {
  tsMs: number;
  value: number;
}

interface PendingMarkout {
  tsMs: number;
  sign: 1 | -1;
  midAtTrade: number;
  resolvedHorizons: Set<number>;
}

interface PendingFvSample {
  tsMs: number;
  emaOfi: number;
  midAtSample: number;
  // beta frozen at sample time, so hit-rate scoring is causal (never scored
  // against a beta fit using data from after the prediction was made).
  predictedEdgeLogit: number;
}

// Generalization of PendingFvSample/resolveFvSamples below to *every*
// takeLabeledSnapshot() call, across all MARKOUT_HORIZONS_SEC rather than
// just FV_HORIZON_SEC -- this is the offline-training analogue of that
// causal buffer: a feature vector taken now, whose forward outcome we can
// only know once the horizon has actually elapsed. See future.md's data
// logging step 2.
interface PendingSnapshotLabel {
  snapshotId: string;
  tsMs: number;
  midAtSnapshot: number;
  resolvedHorizons: Set<number>;
}

/** A feature-vector snapshot tagged with an id that later-resolved
 * ResolvedLabel entries reference, so training data can be reconstructed by
 * joining snapshot -> outcome after the fact. */
export interface LabeledSnapshot {
  snapshotId: string;
  snapshot: AnalyticsState;
}

/** A realized forward logit(mid) drift for a given horizon, resolved
 * strictly after that horizon has elapsed -- never computed against data
 * from before the snapshot it labels. */
export interface ResolvedLabel {
  snapshotId: string;
  horizonSec: number;
  realizedForwardDriftLogit: number;
  resolvedAtMs: number;
}

function topOfBook(book: OrderbookState): { bid: PriceSize; ask: PriceSize } | null {
  if (book.yes.length === 0 || book.no.length === 0) return null;
  return {
    bid: { price: book.yes[0].priceDollars, size: book.yes[0].size },
    ask: { price: 1 - book.no[0].priceDollars, size: book.no[0].size },
  };
}

// Cont-Kukanov-Stoikov per-level order-flow contribution. `prev`/`cur` must
// already be in "improvement = higher price" terms (negate ask prices before
// calling this so a price drop registers as an improvement).
function levelContribution(prev: PriceSize | null, cur: PriceSize): number {
  if (!prev) return 0;
  if (cur.price > prev.price) return cur.size;
  if (cur.price < prev.price) return -prev.size;
  return cur.size - prev.size;
}

function slopeFromLevels(
  levels: PriceSize[],
  bestPrice: number,
  side: "bid" | "ask",
): number | null {
  if (levels.length < 2) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  let cum = 0;
  for (const level of levels) {
    cum += level.size;
    const distCents =
      side === "bid" ? (bestPrice - level.price) * 100 : (level.price - bestPrice) * 100;
    xs.push(distCents);
    ys.push(cum);
  }
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

function entropyFromSizes(sizes: number[]): number | null {
  const positive = sizes.filter((s) => s > 0);
  if (positive.length < 2) return null;
  const total = positive.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let h = 0;
  for (const s of positive) {
    const p = s / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(positive.length);
}

function avg(samples: WindowedNumber[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((a, s) => a + s.value, 0) / samples.length;
}

/**
 * Consumes the same orderbook/trade stream the relay broadcasts and derives
 * rolling microstructure analytics for whichever market is currently locked.
 * One instance per relay process; call reset() whenever the lock changes.
 */
export class MarketAnalytics {
  private marketTicker: string | null = null;
  private lastBook: OrderbookState | null = null;
  private dirty = false;

  private midHistory: MidSample[] = [];
  private lastBid: PriceSize | null = null;
  private lastAsk: PriceSize | null = null;
  private ofiSamples: WindowedNumber[] = [];

  private deltaEventTimestamps: number[] = [];
  private cancelEventTimestamps: number[] = [];
  private tradeTimestamps: number[] = [];

  private effSpreadSamples: WindowedNumber[] = [];
  private amihudSamples: WindowedNumber[] = [];
  private lastTradePrice: number | null = null;

  private pendingMarkouts: PendingMarkout[] = [];
  private markoutSamples = new Map<number, WindowedNumber[]>();

  private kyleIntervals: { signedVolume: number; midChange: number }[] = [];
  private kyleIntervalStartMs = Date.now();
  private kyleIntervalStartMid: number | null = null;
  private kyleIntervalSignedVolume = 0;

  private vpinBuckets: number[] = [];
  private vpinBucketBuyVol = 0;
  private vpinBucketSellVol = 0;
  private recentTradeSizes: number[] = [];

  private spreadEma: number | null = null;
  private shockActive = false;
  private shockStartMs = 0;
  private lastResiliencyMs: number | null = null;

  private emaOfi = 0;
  private hasEmaOfi = false;
  private lastFvSampleMs = 0;
  private pendingFvSamples: PendingFvSample[] = [];
  private fvCalibration: { x: number; y: number }[] = [];
  private fvHitHistory: boolean[] = [];

  private pendingSnapshotLabels: PendingSnapshotLabel[] = [];
  private resolvedLabels: ResolvedLabel[] = [];

  reset(marketTicker: string): void {
    this.marketTicker = marketTicker;
    this.lastBook = null;
    this.dirty = false;

    this.midHistory = [];
    this.lastBid = null;
    this.lastAsk = null;
    this.ofiSamples = [];

    this.deltaEventTimestamps = [];
    this.cancelEventTimestamps = [];
    this.tradeTimestamps = [];

    this.effSpreadSamples = [];
    this.amihudSamples = [];
    this.lastTradePrice = null;

    this.pendingMarkouts = [];
    this.markoutSamples = new Map();

    this.kyleIntervals = [];
    this.kyleIntervalStartMs = Date.now();
    this.kyleIntervalStartMid = null;
    this.kyleIntervalSignedVolume = 0;

    this.vpinBuckets = [];
    this.vpinBucketBuyVol = 0;
    this.vpinBucketSellVol = 0;
    this.recentTradeSizes = [];

    this.spreadEma = null;
    this.shockActive = false;
    this.shockStartMs = 0;
    this.lastResiliencyMs = null;

    this.emaOfi = 0;
    this.hasEmaOfi = false;
    this.lastFvSampleMs = 0;
    this.pendingFvSamples = [];
    this.fvCalibration = [];
    this.fvHitHistory = [];

    this.pendingSnapshotLabels = [];
    this.resolvedLabels = [];
  }

  onBookEvent(kind: "snapshot" | "delta", deltaFp?: number): void {
    if (kind !== "delta" || !this.marketTicker) return;
    const now = Date.now();
    this.deltaEventTimestamps.push(now);
    if ((deltaFp ?? 0) < 0) this.cancelEventTimestamps.push(now);
    this.dirty = true;
  }

  onOrderbook(book: OrderbookState): void {
    if (!this.marketTicker || book.marketTicker !== this.marketTicker) return;
    this.lastBook = book;
    const now = Date.now();
    const top = topOfBook(book);

    if (top) {
      const mid = (top.bid.price + top.ask.price) / 2;
      this.midHistory.push({ tsMs: now, mid });

      const bidContribution = levelContribution(this.lastBid, top.bid);
      const askContribution = levelContribution(
        this.lastAsk ? { price: -this.lastAsk.price, size: this.lastAsk.size } : null,
        { price: -top.ask.price, size: top.ask.size },
      );
      const rawOfi = bidContribution - askContribution;
      this.ofiSamples.push({ tsMs: now, value: rawOfi });
      this.lastBid = top.bid;
      this.lastAsk = top.ask;

      this.emaOfi = this.hasEmaOfi
        ? this.emaOfi * (1 - FV_OFI_EMA_ALPHA) + rawOfi * FV_OFI_EMA_ALPHA
        : rawOfi;
      this.hasEmaOfi = true;
      this.resolveFvSamples(now, mid);
      this.resolveSnapshotLabels(now, mid);
      if (now - this.lastFvSampleMs >= FV_SAMPLE_INTERVAL_MS) {
        const beta = this.fvBeta();
        this.pendingFvSamples.push({
          tsMs: now,
          emaOfi: this.emaOfi,
          midAtSample: mid,
          predictedEdgeLogit: beta != null ? beta * this.emaOfi : 0,
        });
        this.lastFvSampleMs = now;
      }

      this.updateResiliency(top.ask.price - top.bid.price, now);

      if (this.kyleIntervalStartMid == null) {
        this.kyleIntervalStartMid = mid;
        this.kyleIntervalStartMs = now;
      } else if (now - this.kyleIntervalStartMs >= KYLE_INTERVAL_MS) {
        this.kyleIntervals.push({
          signedVolume: this.kyleIntervalSignedVolume,
          midChange: mid - this.kyleIntervalStartMid,
        });
        if (this.kyleIntervals.length > KYLE_MAX_INTERVALS) this.kyleIntervals.shift();
        this.kyleIntervalStartMid = mid;
        this.kyleIntervalStartMs = now;
        this.kyleIntervalSignedVolume = 0;
      }
    }

    this.resolveMarkouts(now);
    this.pruneWindowed(now);
    this.dirty = true;
  }

  onTrade(trade: TradeEvent): void {
    if (!this.marketTicker || trade.marketTicker !== this.marketTicker) return;
    const now = trade.tsMs || Date.now();
    const sign: 1 | -1 = trade.takerSide === "yes" ? 1 : -1;
    const price = Number(trade.yesPriceDollars);
    const size = Number(trade.count);
    if (Number.isNaN(price) || Number.isNaN(size)) return;

    this.tradeTimestamps.push(now);

    const mid = this.currentMid();
    if (mid != null) {
      this.effSpreadSamples.push({ tsMs: now, value: 2 * Math.abs(price - mid) });
      this.pendingMarkouts.push({ tsMs: now, sign, midAtTrade: mid, resolvedHorizons: new Set() });
    }

    if (this.lastTradePrice != null) {
      const logitRet = logit(price) - logit(this.lastTradePrice);
      const dollarVol = price * size;
      if (dollarVol > 0) {
        this.amihudSamples.push({ tsMs: now, value: Math.abs(logitRet) / dollarVol });
      }
    }
    this.lastTradePrice = price;

    this.kyleIntervalSignedVolume += sign * size;

    this.recentTradeSizes.push(size);
    if (this.recentTradeSizes.length > 100) this.recentTradeSizes.shift();
    if (sign === 1) this.vpinBucketBuyVol += size;
    else this.vpinBucketSellVol += size;
    const bucketVolume = this.vpinBucketBuyVol + this.vpinBucketSellVol;
    if (bucketVolume >= this.vpinBucketTarget()) {
      const imbalance = Math.abs(this.vpinBucketBuyVol - this.vpinBucketSellVol) / bucketVolume;
      this.vpinBuckets.push(imbalance);
      if (this.vpinBuckets.length > VPIN_BUCKET_COUNT) this.vpinBuckets.shift();
      this.vpinBucketBuyVol = 0;
      this.vpinBucketSellVol = 0;
    }

    this.pruneWindowed(now);
    this.dirty = true;
  }

  consumeDirty(): boolean {
    const wasDirty = this.dirty;
    this.dirty = false;
    return wasDirty;
  }

  snapshot(): AnalyticsState | null {
    if (!this.marketTicker || !this.lastBook) return null;
    const micro = this.microstructureFromBook(this.lastBook);
    const markouts: MarkoutPoint[] = MARKOUT_HORIZONS_SEC.map((horizonSec) => {
      const samples = this.markoutSamples.get(horizonSec) ?? [];
      return { horizonSec, avgDollars: avg(samples), sampleCount: samples.length };
    });
    const tradeCount = this.tradeTimestamps.length;

    const mid = this.currentMid();
    const beta = this.fvBeta();
    const confidence = this.fvConfidence();
    let fairValueDollars: number | null = null;
    let fairValueEdgeDollars: number | null = null;
    if (beta != null && mid != null) {
      fairValueDollars = sigmoid(logit(mid) + beta * this.emaOfi * confidence);
      fairValueEdgeDollars = fairValueDollars - mid;
    }

    return {
      marketTicker: this.marketTicker,
      updatedAtMs: Date.now(),
      windowSec: WINDOW_MS / 1000,
      ...micro,
      ofi: this.ofiSamples.length > 0 ? this.ofiSamples.reduce((a, s) => a + s.value, 0) : null,
      quoteToTradeRatio: tradeCount > 0 ? this.deltaEventTimestamps.length / tradeCount : null,
      cancelToTradeRatio: tradeCount > 0 ? this.cancelEventTimestamps.length / tradeCount : null,
      realizedVolLogit: this.realizedVolLogit(),
      amihudLogit: avg(this.amihudSamples),
      kyleLambda: this.kyleLambda(),
      effectiveSpreadDollars: avg(this.effSpreadSamples),
      markouts,
      vpin: this.currentVpin(),
      resiliencyMs: this.lastResiliencyMs,
      resiliencyActive: this.shockActive,
      fairValueDollars,
      fairValueEdgeDollars,
      fvBeta: beta,
      fvConfidence: confidence,
      fvHitRate: this.fvHitRate(),
      fvSampleCount: this.fvCalibration.length,
    };
  }

  /**
   * Like snapshot(), but tags the result with a stable id and registers it
   * in a causal pending buffer so forward outcomes can be resolved later
   * (see resolveSnapshotLabels/drainResolvedLabels) without ever looking
   * ahead of the moment the snapshot was taken.
   */
  takeLabeledSnapshot(): LabeledSnapshot | null {
    const snap = this.snapshot();
    if (!snap) return null;
    const snapshotId = `${snap.marketTicker}:${snap.updatedAtMs}`;
    const mid = this.currentMid();
    if (mid != null) {
      this.pendingSnapshotLabels.push({
        snapshotId,
        tsMs: snap.updatedAtMs,
        midAtSnapshot: mid,
        resolvedHorizons: new Set(),
      });
    }
    return { snapshotId, snapshot: snap };
  }

  /** Drains and returns forward-outcome labels resolved since the last call. */
  drainResolvedLabels(): ResolvedLabel[] {
    const drained = this.resolvedLabels;
    this.resolvedLabels = [];
    return drained;
  }

  private currentMid(): number | null {
    return this.midHistory.length > 0 ? this.midHistory[this.midHistory.length - 1].mid : null;
  }

  private currentVpin(): number | null {
    if (this.vpinBuckets.length === 0) return null;
    return this.vpinBuckets.reduce((a, b) => a + b, 0) / this.vpinBuckets.length;
  }

  private microstructureFromBook(book: OrderbookState): {
    spreadDollars: number | null;
    micropriceDollars: number | null;
    obiTop: number | null;
    obiDepth: number | null;
    bookSlopeBid: number | null;
    bookSlopeAsk: number | null;
    bookEntropy: number | null;
  } {
    const top = topOfBook(book);
    if (!top) {
      return {
        spreadDollars: null,
        micropriceDollars: null,
        obiTop: null,
        obiDepth: null,
        bookSlopeBid: null,
        bookSlopeAsk: null,
        bookEntropy: null,
      };
    }

    const spreadDollars = top.ask.price - top.bid.price;
    const totalTop = top.bid.size + top.ask.size;
    const micropriceDollars =
      totalTop > 0 ? (top.bid.price * top.ask.size + top.ask.price * top.bid.size) / totalTop : null;
    const obiTop = totalTop > 0 ? (top.bid.size - top.ask.size) / totalTop : null;

    const bidLevels: PriceSize[] = book.yes
      .slice(0, DEPTH_LEVELS)
      .map((l) => ({ price: l.priceDollars, size: l.size }));
    const askLevels: PriceSize[] = book.no
      .slice(0, DEPTH_LEVELS)
      .map((l) => ({ price: 1 - l.priceDollars, size: l.size }));

    const bidDepth = bidLevels.reduce((a, l) => a + l.size, 0);
    const askDepth = askLevels.reduce((a, l) => a + l.size, 0);
    const obiDepth = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : null;

    const bookSlopeBid = slopeFromLevels(bidLevels.slice(0, SLOPE_LEVELS), top.bid.price, "bid");
    const bookSlopeAsk = slopeFromLevels(askLevels.slice(0, SLOPE_LEVELS), top.ask.price, "ask");

    const bookEntropy = entropyFromSizes([...bidLevels, ...askLevels].map((l) => l.size));

    return {
      spreadDollars,
      micropriceDollars,
      obiTop,
      obiDepth,
      bookSlopeBid,
      bookSlopeAsk,
      bookEntropy,
    };
  }

  private resolveMarkouts(now: number): void {
    const mid = this.currentMid();
    if (mid == null) return;
    this.pendingMarkouts = this.pendingMarkouts.filter((p) => {
      for (const horizonSec of MARKOUT_HORIZONS_SEC) {
        if (p.resolvedHorizons.has(horizonSec)) continue;
        if (now - p.tsMs >= horizonSec * 1000) {
          const realizedSpread = 2 * p.sign * (p.midAtTrade - mid);
          const samples = this.markoutSamples.get(horizonSec) ?? [];
          samples.push({ tsMs: now, value: realizedSpread });
          this.markoutSamples.set(horizonSec, samples);
          p.resolvedHorizons.add(horizonSec);
        }
      }
      return (
        p.resolvedHorizons.size < MARKOUT_HORIZONS_SEC.length && now - p.tsMs < MAX_MARKOUT_WAIT_MS
      );
    });
  }

  // Causal: resolves samples whose horizon has elapsed using the *current*
  // mid, then folds them into the calibration buffer that fvBeta() reads.
  // predictedEdgeLogit on each pending sample was frozen using whatever beta
  // existed when the sample was taken, so hit-rate scoring never peeks ahead.
  private resolveFvSamples(now: number, mid: number): void {
    this.pendingFvSamples = this.pendingFvSamples.filter((p) => {
      if (now - p.tsMs >= FV_HORIZON_SEC * 1000) {
        const realizedLogitChange = logit(mid) - logit(p.midAtSample);
        this.fvCalibration.push({ x: p.emaOfi, y: realizedLogitChange });
        if (this.fvCalibration.length > FV_MAX_CALIBRATION_SAMPLES) this.fvCalibration.shift();

        if (p.predictedEdgeLogit !== 0) {
          this.fvHitHistory.push(
            Math.sign(p.predictedEdgeLogit) === Math.sign(realizedLogitChange),
          );
          if (this.fvHitHistory.length > FV_MAX_CALIBRATION_SAMPLES) this.fvHitHistory.shift();
        }
        return false;
      }
      return now - p.tsMs < FV_MAX_PENDING_WAIT_MS;
    });
  }

  // Same causal shape as resolveMarkouts/resolveFvSamples above, generalized
  // to every takeLabeledSnapshot() sample and all MARKOUT_HORIZONS_SEC, for
  // offline training rather than online calibration -- see future.md's data
  // logging step 2 for why this must never peek past `now`.
  private resolveSnapshotLabels(now: number, mid: number): void {
    this.pendingSnapshotLabels = this.pendingSnapshotLabels.filter((p) => {
      for (const horizonSec of MARKOUT_HORIZONS_SEC) {
        if (p.resolvedHorizons.has(horizonSec)) continue;
        if (now - p.tsMs >= horizonSec * 1000) {
          this.resolvedLabels.push({
            snapshotId: p.snapshotId,
            horizonSec,
            realizedForwardDriftLogit: logit(mid) - logit(p.midAtSnapshot),
            resolvedAtMs: now,
          });
          p.resolvedHorizons.add(horizonSec);
        }
      }
      return (
        p.resolvedHorizons.size < MARKOUT_HORIZONS_SEC.length && now - p.tsMs < MAX_MARKOUT_WAIT_MS
      );
    });
  }

  // Through-origin OLS of realized forward logit(mid) drift on emaOFI at
  // sample time -- same regression shape as kyleLambda() above, just fit
  // against a forward-looking target instead of a contemporaneous one.
  private fvBeta(): number | null {
    if (this.fvCalibration.length < FV_MIN_CALIBRATION_SAMPLES) return null;
    let num = 0;
    let den = 0;
    for (const { x, y } of this.fvCalibration) {
      num += x * y;
      den += x * x;
    }
    if (den === 0) return null;
    return num / den;
  }

  // Regime gate: trust the order-flow adjustment fully in a calm, non-toxic
  // book; collapse it toward raw mid when flow looks informed (high VPIN) or
  // the book is actively shocked, i.e. exactly when the linear fit is least
  // likely to hold.
  private fvConfidence(): number {
    if (this.shockActive) return FV_SHOCK_CONFIDENCE;
    const vpin = this.currentVpin() ?? 0;
    return Math.max(0, 1 - vpin);
  }

  private fvHitRate(): number | null {
    if (this.fvHitHistory.length < FV_MIN_CALIBRATION_SAMPLES) return null;
    const hits = this.fvHitHistory.filter(Boolean).length;
    return hits / this.fvHitHistory.length;
  }

  private updateResiliency(spread: number, now: number): void {
    if (spread <= 0 || Number.isNaN(spread)) return;
    if (this.spreadEma == null) {
      this.spreadEma = spread;
      return;
    }
    if (!this.shockActive && spread > this.spreadEma * SHOCK_MULT) {
      this.shockActive = true;
      this.shockStartMs = now;
    } else if (this.shockActive && spread <= this.spreadEma * RECOVER_MULT) {
      this.lastResiliencyMs = now - this.shockStartMs;
      this.shockActive = false;
    }
    // Don't let the shock itself drag the trailing baseline up while it's
    // in progress -- otherwise a sustained wide spread stops looking like a
    // shock at all.
    if (!this.shockActive) {
      this.spreadEma = this.spreadEma * (1 - SPREAD_EMA_ALPHA) + spread * SPREAD_EMA_ALPHA;
    }
  }

  private vpinBucketTarget(): number {
    if (this.recentTradeSizes.length < VPIN_MIN_TRADES_FOR_TARGET) return Infinity;
    const avgSize =
      this.recentTradeSizes.reduce((a, b) => a + b, 0) / this.recentTradeSizes.length;
    return Math.max(VPIN_MIN_BUCKET_SIZE, avgSize * VPIN_BUCKET_MULTIPLE);
  }

  // Std dev of logit(mid) differences -- the bounded-probability analogue of
  // realized vol on log returns. See the LOGIT_EPS comment above for why.
  private realizedVolLogit(): number | null {
    if (this.midHistory.length < 3) return null;
    const diffs: number[] = [];
    for (let i = 1; i < this.midHistory.length; i++) {
      const prev = this.midHistory[i - 1].mid;
      const cur = this.midHistory[i].mid;
      diffs.push(logit(cur) - logit(prev));
    }
    if (diffs.length < 2) return null;
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (diffs.length - 1);
    return Math.sqrt(variance);
  }

  private kyleLambda(): number | null {
    if (this.kyleIntervals.length < 5) return null;
    let num = 0;
    let den = 0;
    for (const { signedVolume, midChange } of this.kyleIntervals) {
      num += signedVolume * midChange;
      den += signedVolume * signedVolume;
    }
    if (den === 0) return null;
    return num / den;
  }

  private pruneWindowed(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.midHistory = this.midHistory.filter((s) => s.tsMs >= cutoff);
    this.ofiSamples = this.ofiSamples.filter((s) => s.tsMs >= cutoff);
    this.deltaEventTimestamps = this.deltaEventTimestamps.filter((t) => t >= cutoff);
    this.cancelEventTimestamps = this.cancelEventTimestamps.filter((t) => t >= cutoff);
    this.tradeTimestamps = this.tradeTimestamps.filter((t) => t >= cutoff);
    this.effSpreadSamples = this.effSpreadSamples.filter((s) => s.tsMs >= cutoff);
    this.amihudSamples = this.amihudSamples.filter((s) => s.tsMs >= cutoff);
    for (const [horizon, samples] of this.markoutSamples) {
      this.markoutSamples.set(
        horizon,
        samples.filter((s) => s.tsMs >= cutoff),
      );
    }
  }
}
