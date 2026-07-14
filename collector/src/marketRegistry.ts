import { MarketAnalytics } from "@kalshi-terminal/shared/analytics.js";
import type { LabeledSnapshot, ResolvedLabel } from "@kalshi-terminal/shared/analytics.js";
import type { OrderbookState, TradeEvent } from "@kalshi-terminal/shared/types.js";
import type { MultiMarketClient } from "./multiMarketClient.js";

/**
 * One MarketAnalytics instance per actively-tracked ticker -- the exact
 * same feature-computation code the live terminal uses (shared/analytics.ts),
 * just fanned out across many markets instead of a single locked one. This
 * is the piece where reusing the live code (rather than a parallel
 * reimplementation) actually matters, per future.md's train/serve-parity
 * concern.
 */
export class MarketRegistry {
  private analytics = new Map<string, MarketAnalytics>();

  constructor(client: MultiMarketClient) {
    client.on("orderbook", (ticker: string, book: OrderbookState) => {
      this.ensure(ticker).onOrderbook(book);
    });
    client.on("bookEvent", (ticker: string, kind: "snapshot" | "delta", deltaFp?: number) => {
      this.ensure(ticker).onBookEvent(kind, deltaFp);
    });
    client.on("trade", (ticker: string, trade: TradeEvent) => {
      this.ensure(ticker).onTrade(trade);
    });
  }

  private ensure(ticker: string): MarketAnalytics {
    let m = this.analytics.get(ticker);
    if (!m) {
      m = new MarketAnalytics();
      m.reset(ticker);
      this.analytics.set(ticker, m);
    }
    return m;
  }

  /** Called on the collector's snapshot tick: takes a labeled snapshot for
   * every currently-tracked market with book state, and drains any
   * forward-outcome labels resolved since the last call. */
  tick(): { labeled: LabeledSnapshot[]; resolved: Map<string, ResolvedLabel[]> } {
    const labeled: LabeledSnapshot[] = [];
    const resolved = new Map<string, ResolvedLabel[]>();
    for (const [ticker, m] of this.analytics) {
      const snap = m.takeLabeledSnapshot();
      if (snap) labeled.push(snap);
      const drained = m.drainResolvedLabels();
      if (drained.length > 0) resolved.set(ticker, drained);
    }
    return { labeled, resolved };
  }

  /** Drops tracking for a market no longer in the discovered set (closed,
   * settled, or fell out of the ranked top-N). Call tick() first if any
   * still-pending labels for it should be drained before eviction. */
  evict(ticker: string): void {
    this.analytics.delete(ticker);
  }

  trackedTickers(): string[] {
    return [...this.analytics.keys()];
  }
}
