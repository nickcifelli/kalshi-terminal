/** Tallies trade events per market ticker, seen live over the global WS
 * trade feed. Counts are cumulative since process start (no decay/window) —
 * a deliberately simple "recent activity" signal, not a precise trailing
 * time window. */
export class TradeCounter {
  private counts = new Map<string, number>();

  record(ticker: string): void {
    this.counts.set(ticker, (this.counts.get(ticker) ?? 0) + 1);
  }

  topTickers(n: number): { ticker: string; tradeCount: number }[] {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([ticker, tradeCount]) => ({ ticker, tradeCount }));
  }
}
