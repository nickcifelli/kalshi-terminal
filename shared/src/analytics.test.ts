import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketAnalytics } from "./analytics.js";
import type { OrderbookState, TradeEvent } from "./types.js";

// These tests lock in the one property future.md calls out as the whole
// game for training-data correctness: every forward-looking resolution
// (markouts, snapshot labels) must only ever use data from at/after the
// horizon it's labeling, never before -- and must never fire early just
// because *some* horizon or *some* update happened to arrive.

function book(ticker: string, bidPrice: number, askPrice: number): OrderbookState {
  return {
    marketTicker: ticker,
    yes: [{ priceDollars: bidPrice, size: 100 }],
    no: [{ priceDollars: 1 - askPrice, size: 100 }],
  };
}

function trade(ticker: string, priceDollars: number, tsMs: number): TradeEvent {
  return {
    tradeId: "t1",
    marketTicker: ticker,
    yesPriceDollars: String(priceDollars),
    noPriceDollars: String(1 - priceDollars),
    count: "10",
    takerSide: "yes",
    tsMs,
  };
}

test("markouts never resolve before their horizon elapses, and use the mid at resolution time", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const a = new MarketAnalytics();
  a.reset("TICK");

  a.onOrderbook(book("TICK", 0.5, 0.52)); // mid = 0.51
  a.onTrade(trade("TICK", 0.55, Date.now())); // taker side "yes" -> sign +1, midAtTrade = 0.51

  t.mock.timers.tick(4_999);
  a.onOrderbook(book("TICK", 0.53, 0.55)); // mid moves, but only 4999ms elapsed
  const early = a.snapshot()!.markouts.find((m) => m.horizonSec === 5)!;
  assert.equal(early.sampleCount, 0, "must not resolve before the horizon elapses");

  t.mock.timers.tick(2); // 5001ms since the trade
  a.onOrderbook(book("TICK", 0.6, 0.62)); // mid = 0.61
  const resolved = a.snapshot()!.markouts.find((m) => m.horizonSec === 5)!;
  assert.equal(resolved.sampleCount, 1, "must resolve once the horizon has elapsed");
  // realizedSpread = 2 * sign * (midAtTrade - midAtResolution) = 2 * 1 * (0.51 - 0.61)
  assert.ok(resolved.avgDollars != null && Math.abs(resolved.avgDollars - -0.2) < 1e-9);
});

test("snapshot labels never resolve before their horizon, and different horizons resolve independently", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const a = new MarketAnalytics();
  a.reset("TICK");

  a.onOrderbook(book("TICK", 0.5, 0.52)); // mid = 0.51
  const labeled = a.takeLabeledSnapshot();
  assert.ok(labeled);

  t.mock.timers.tick(4_999);
  a.onOrderbook(book("TICK", 0.53, 0.55));
  assert.deepEqual(a.drainResolvedLabels(), [], "must not resolve before the horizon elapses");

  t.mock.timers.tick(2); // 5001ms since the snapshot was taken
  a.onOrderbook(book("TICK", 0.6, 0.62)); // mid moved up to 0.61
  const resolved = a.drainResolvedLabels();

  const label5 = resolved.find((l) => l.horizonSec === 5);
  assert.ok(label5, "5s label should resolve once its horizon elapses");
  assert.equal(label5!.snapshotId, labeled!.snapshotId);
  assert.ok(
    label5!.realizedForwardDriftLogit > 0,
    "drift must reflect the mid at resolution time (up), not the mid at snapshot time",
  );
  assert.ok(
    !resolved.some((l) => l.horizonSec === 30 || l.horizonSec === 60),
    "longer horizons must not resolve early just because the 5s one did",
  );
});

test("drainResolvedLabels only returns each resolved label once", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const a = new MarketAnalytics();
  a.reset("TICK");

  a.onOrderbook(book("TICK", 0.5, 0.52));
  a.takeLabeledSnapshot();

  t.mock.timers.tick(5_001);
  a.onOrderbook(book("TICK", 0.6, 0.62));
  const first = a.drainResolvedLabels();
  assert.ok(first.some((l) => l.horizonSec === 5));

  a.onOrderbook(book("TICK", 0.6, 0.62));
  const second = a.drainResolvedLabels();
  assert.deepEqual(second, [], "already-drained labels must not be returned again");
});
