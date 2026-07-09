import type { TradeEvent } from "../types";

function fmtTime(tsMs: number): string {
  const d = new Date(tsMs);
  return d.toLocaleTimeString([], { hour12: false });
}

export function TradesPanel(props: { trades: TradeEvent[] }) {
  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-title">Trades</div>
      <div className="panel-body">
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: 11, marginBottom: 4 }}>
          <span>TIME</span>
          <span>SIDE</span>
          <span>PRICE</span>
          <span>SIZE</span>
        </div>
        {props.trades.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>waiting for trades…</div>
        )}
        {props.trades.map((t) => {
          const isYes = t.takerSide === "yes";
          const color = isYes ? "var(--green)" : "var(--red)";
          const price = isYes ? t.yesPriceDollars : t.noPriceDollars;
          return (
            <div
              key={t.tradeId}
              className="mono-num"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "1px 0" }}
            >
              <span style={{ color: "var(--text-dim)" }}>{fmtTime(t.tsMs)}</span>
              <span style={{ color, width: 36, textAlign: "center" }}>{t.takerSide.toUpperCase()}</span>
              <span style={{ color }}>{(Number(price) * 100).toFixed(1)}¢</span>
              <span>{Math.round(Number(t.count)).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
