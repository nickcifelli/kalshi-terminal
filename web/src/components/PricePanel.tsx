import { useEffect, useRef, useState } from "react";
import type { PricePoint } from "../hooks/useTerminalSocket";
import type { TickerState } from "../types";
import { Sparkline } from "./Sparkline";

function fmtCents(dollars: string | null): string {
  if (dollars == null) return "--";
  const n = Number(dollars);
  if (Number.isNaN(n)) return "--";
  return `${(n * 100).toFixed(1)}¢`;
}

function fmtCount(v: string | null): string {
  if (v == null) return "--";
  const n = Number(v);
  if (Number.isNaN(n)) return "--";
  return Math.round(n).toLocaleString();
}

export function PricePanel(props: { ticker: TickerState | null; priceHistory: PricePoint[] }) {
  const { ticker, priceHistory } = props;
  const prevPrice = useRef<number | null>(null);
  const [direction, setDirection] = useState<"up" | "down" | "flat">("flat");

  useEffect(() => {
    if (!ticker?.priceDollars) return;
    const n = Number(ticker.priceDollars);
    if (prevPrice.current != null) {
      if (n > prevPrice.current) setDirection("up");
      else if (n < prevPrice.current) setDirection("down");
    }
    prevPrice.current = n;
  }, [ticker?.priceDollars]);

  const color = direction === "up" ? "var(--green)" : direction === "down" ? "var(--red)" : "var(--text)";

  return (
    <div className="panel" style={{ flex: "0 0 auto" }}>
      <div className="panel-title">Last Price</div>
      <div className="panel-body" style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
        <div
          className="mono-num"
          style={{ fontSize: 42, fontWeight: 700, color, minWidth: 140 }}
        >
          {fmtCents(ticker?.priceDollars ?? null)}
        </div>

        <div style={{ display: "flex", gap: 32, color: "var(--text-dim)", fontSize: 12 }}>
          <div>
            <div>YES BID</div>
            <div className="mono-num up" style={{ fontSize: 16 }}>
              {fmtCents(ticker?.yesBidDollars ?? null)}
            </div>
          </div>
          <div>
            <div>YES ASK</div>
            <div className="mono-num down" style={{ fontSize: 16 }}>
              {fmtCents(ticker?.yesAskDollars ?? null)}
            </div>
          </div>
          <div>
            <div>VOLUME</div>
            <div className="mono-num" style={{ fontSize: 16, color: "var(--text)" }}>
              {fmtCount(ticker?.volume ?? null)}
            </div>
          </div>
          <div>
            <div>OPEN INT.</div>
            <div className="mono-num" style={{ fontSize: 16, color: "var(--text)" }}>
              {fmtCount(ticker?.openInterest ?? null)}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          {priceHistory.length >= 2 ? (
            <Sparkline
              data={priceHistory.map((p) => ({ x: p.tsMs, y: p.priceDollars }))}
              width={260}
              height={48}
              color={color}
              interactive
              formatValue={(y) => `${(y * 100).toFixed(1)}¢`}
            />
          ) : (
            <div style={{ width: 260, height: 48, color: "var(--text-dim)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
              awaiting ticks…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
