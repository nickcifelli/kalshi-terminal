import { useState } from "react";
import type { MarketSummary } from "../types";

function fmtCents(dollars: string | null): string {
  if (dollars == null) return "--";
  const n = Number(dollars);
  if (Number.isNaN(n)) return "--";
  return `${(n * 100).toFixed(1)}¢`;
}

export function MarketPicker(props: {
  topMarkets: MarketSummary[] | null;
  relayStatus: "connecting" | "open" | "closed";
  onLock: (ticker: string) => void;
}) {
  const [input, setInput] = useState("");

  return (
    <div
      className="term"
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "var(--amber)", fontWeight: 700, letterSpacing: "0.08em", fontSize: 20 }}>
            KALSHI TERMINAL
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 4 }}>
            SELECT A MARKET
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) props.onLock(input);
          }}
          style={{ display: "flex", gap: 6 }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="TICKER e.g. KXHIGHNY-26JUL10-B75.5"
            spellCheck={false}
            autoFocus
            style={{
              flex: 1,
              background: "#000",
              border: "1px solid var(--border)",
              color: "var(--cyan)",
              fontFamily: "var(--mono)",
              fontSize: 13,
              padding: "8px 10px",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            style={{
              background: "var(--amber)",
              color: "#000",
              border: "none",
              fontFamily: "var(--mono)",
              fontWeight: 700,
              fontSize: 12,
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            LOCK
          </button>
        </form>

        <div className="panel">
          <div className="panel-title">Top {props.topMarkets?.length ?? 10} by live trade count</div>
          <div className="panel-body" style={{ padding: 0 }}>
            {props.relayStatus !== "open" ? (
              <div style={{ padding: "16px 10px", color: "var(--text-dim)" }}>
                Connecting to relay...
              </div>
            ) : props.topMarkets == null ? (
              <div style={{ padding: "16px 10px", color: "var(--text-dim)" }}>
                Watching live trades...
              </div>
            ) : props.topMarkets.length === 0 ? (
              <div style={{ padding: "16px 10px", color: "var(--text-dim)" }}>
                No markets found.
              </div>
            ) : (
              props.topMarkets.map((m) => (
                <button
                  key={m.ticker}
                  onClick={() => props.onLock(m.ticker)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    padding: "10px",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#0f1520")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "var(--cyan)", fontWeight: 700 }}>{m.ticker}</div>
                    {m.title && (
                      <div
                        style={{
                          color: "var(--text-dim)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.title}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                    <div className="mono-num">{fmtCents(m.yesBidDollars)} / {fmtCents(m.yesAskDollars)}</div>
                    <div className="mono-num" style={{ color: "var(--text-dim)" }}>
                      {m.tradeCount.toLocaleString()} trades
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
