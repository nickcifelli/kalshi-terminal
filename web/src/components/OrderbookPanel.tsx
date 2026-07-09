import type { OrderbookState } from "../types";

function Side(props: { label: string; color: string; levels: { priceDollars: number; size: number }[] }) {
  const maxSize = Math.max(1, ...props.levels.map((l) => l.size));
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: props.color, fontSize: 11, marginBottom: 4, letterSpacing: "0.06em" }}>
        {props.label}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: 11, marginBottom: 2 }}>
        <span>PRICE</span>
        <span>SIZE</span>
      </div>
      {props.levels.length === 0 && (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>no resting orders</div>
      )}
      {props.levels.slice(0, 12).map((level) => (
        <div
          key={level.priceDollars}
          className="mono-num"
          style={{
            display: "flex",
            justifyContent: "space-between",
            position: "relative",
            padding: "1px 4px",
            fontSize: 12,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              right: `${100 - (level.size / maxSize) * 100}%`,
              background: props.color,
              opacity: 0.12,
            }}
          />
          <span style={{ position: "relative", color: props.color }}>
            {(level.priceDollars * 100).toFixed(1)}¢
          </span>
          <span style={{ position: "relative" }}>{Math.round(level.size).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function OrderbookPanel(props: { orderbook: OrderbookState | null }) {
  const yes = props.orderbook?.yes ?? [];
  const no = props.orderbook?.no ?? [];
  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-title">Orderbook</div>
      <div className="panel-body" style={{ display: "flex", gap: 16 }}>
        <Side label="YES BIDS" color="var(--green)" levels={yes} />
        <Side label="NO BIDS" color="var(--red)" levels={no} />
      </div>
    </div>
  );
}
