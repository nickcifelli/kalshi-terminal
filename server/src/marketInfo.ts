import { config } from "./config.js";
import type { LockedMarketInfo, MarketSummary } from "./types.js";

/** Fetches the raw market doc from Kalshi's public (no-auth) markets endpoint. */
async function fetchMarketDoc(ticker: string): Promise<any> {
  const url = `${config.restBaseUrl}/markets/${encodeURIComponent(ticker)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Market lookup failed for "${ticker}": ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { market: any };
  return body.market;
}

/**
 * Fetches display metadata (title, subtitle, status, close time) for a
 * market ticker. This endpoint is public and needs no auth headers.
 */
export async function fetchMarketInfo(
  ticker: string,
): Promise<LockedMarketInfo> {
  const m = await fetchMarketDoc(ticker);
  return {
    ticker: m.ticker,
    title: m.yes_sub_title || m.title || null,
    subtitle: m.no_sub_title ?? null,
    status: m.status ?? null,
    closeTime: m.close_time ?? null,
  };
}

/**
 * Fetches display metadata (title, bid/ask, close time) for a market
 * ticker, for enriching the trade-count leaderboard. Returns null instead
 * of throwing so one bad/delisted ticker doesn't drop the whole leaderboard
 * refresh.
 */
export async function fetchMarketSummary(
  ticker: string,
): Promise<Omit<MarketSummary, "tradeCount"> | null> {
  try {
    const m = await fetchMarketDoc(ticker);
    return {
      ticker: m.ticker,
      title: m.yes_sub_title || m.title || null,
      subtitle: m.no_sub_title ?? null,
      yesBidDollars: m.yes_bid_dollars ?? null,
      yesAskDollars: m.yes_ask_dollars ?? null,
      closeTime: m.close_time ?? null,
    };
  } catch {
    return null;
  }
}
