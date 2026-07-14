import { config } from "./config.js";

// Bound the scan so a Kalshi-wide "every open market" pagination (which can
// run into the thousands, especially with single-game sports markets)
// doesn't turn into an unbounded number of REST calls every discovery tick.
const MAX_PAGES = 10;
const PAGE_LIMIT = 1000;

interface RankedMarket {
  ticker: string;
  volume: number;
}

async function fetchMarketsPage(
  cursor: string | null,
): Promise<{ markets: any[]; cursor: string | null }> {
  const url = new URL(`${config.restBaseUrl}/markets`);
  url.searchParams.set("status", "open");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  // Excludes Kalshi's bulk-generated "multivariate event" markets (e.g. the
  // KXMVESPORTSMULTIGAMEEXTENDED/KXMVECROSSCATEGORY families) -- confirmed
  // live that these make up the entire first several pages of /markets with
  // literally zero volume on every one, which would otherwise starve the
  // page-capped scan below of ever reaching genuinely liquid markets.
  url.searchParams.set("mve_filter", "exclude");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Market discovery fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { markets?: any[]; cursor?: string };
  return { markets: body.markets ?? [], cursor: body.cursor || null };
}

/**
 * Scans open markets via paginated REST (public, no auth needed -- same
 * endpoint marketInfo.ts's fetchMarketSummary hits for one ticker at a
 * time) and ranks by trailing volume, returning the top `limit` tickers.
 *
 * Category breadth (politics/sports/macro, per future.md's heterogeneity
 * concern) is not filtered here -- Kalshi's /markets endpoint doesn't
 * document a category param, so this ranks by volume across the whole
 * open-market set as a starting heuristic. Revisit with a series-ticker
 * prefix or /series lookup if the resulting mix turns out too narrow.
 */
export async function discoverTopMarkets(limit: number): Promise<string[]> {
  const ranked: RankedMarket[] = [];
  let cursor: string | null = null;
  let pages = 0;

  do {
    const page = await fetchMarketsPage(cursor);
    for (const m of page.markets) {
      if (!m.ticker) continue;
      const volume = Number(m.volume_24h_fp ?? m.volume_fp ?? 0);
      ranked.push({ ticker: m.ticker, volume });
    }
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  return ranked
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit)
    .map((m) => m.ticker);
}
