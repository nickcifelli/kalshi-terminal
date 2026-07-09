import { config } from "./config.js";
import type { LockedMarketInfo } from "./types.js";

/**
 * Fetches display metadata (title, subtitle, status, close time) for a
 * market ticker. This endpoint is public and needs no auth headers.
 */
export async function fetchMarketInfo(
  ticker: string,
): Promise<LockedMarketInfo> {
  const url = `${config.restBaseUrl}/markets/${encodeURIComponent(ticker)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Market lookup failed for "${ticker}": ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { market: any };
  const m = body.market;
  return {
    ticker: m.ticker,
    title: m.yes_sub_title || m.title || null,
    subtitle: m.no_sub_title ?? null,
    status: m.status ?? null,
    closeTime: m.close_time ?? null,
  };
}
