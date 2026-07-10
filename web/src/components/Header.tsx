import { useState } from "react";
import type { ConnectionStatus, LockedMarketInfo } from "../types";

function statusColor(relay: string, upstream: ConnectionStatus | null): string {
  if (relay !== "open") return "var(--red)";
  if (upstream === "connected") return "var(--green)";
  if (upstream === "connecting" || upstream === "reconnecting") return "var(--amber)";
  return "var(--red)";
}

function statusLabel(relay: string, upstream: ConnectionStatus | null): string {
  if (relay !== "open") return "RELAY OFFLINE";
  if (!upstream) return "STARTING";
  return upstream.toUpperCase();
}

export function Header(props: {
  relayStatus: "connecting" | "open" | "closed";
  upstreamStatus: ConnectionStatus | null;
  market: LockedMarketInfo | null;
  onLock: (ticker: string) => void;
  onChangeMarket: () => void;
}) {
  const [input, setInput] = useState("");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "8px 12px",
        border: "1px solid var(--border)",
        borderRadius: 2,
        background: "var(--panel-bg)",
      }}
    >
      <div style={{ color: "var(--amber)", fontWeight: 700, letterSpacing: "0.08em" }}>
        KALSHI TERMINAL
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) props.onLock(input);
          setInput("");
        }}
        style={{ display: "flex", gap: 6 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="TICKER e.g. KXHIGHNY-26JUL10-B75.5"
          spellCheck={false}
          style={{
            background: "#000",
            border: "1px solid var(--border)",
            color: "var(--cyan)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "4px 8px",
            width: 300,
          }}
        />
        <button
          type="submit"
          style={{
            background: "var(--amber)",
            color: "#000",
            border: "none",
            fontFamily: "var(--mono)",
            fontWeight: 700,
            fontSize: 12,
            padding: "4px 12px",
            cursor: "pointer",
          }}
        >
          LOCK
        </button>
      </form>

      <button
        type="button"
        onClick={props.onChangeMarket}
        style={{
          background: "transparent",
          color: "var(--text-dim)",
          border: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          padding: "4px 10px",
          cursor: "pointer",
        }}
      >
        CHANGE MARKET
      </button>

      <div style={{ flex: 1, textAlign: "center" }}>
        {props.market ? (
          <span>
            <span style={{ color: "var(--cyan)", fontWeight: 700 }}>
              {props.market.ticker}
            </span>
            {props.market.title && (
              <span style={{ color: "var(--text-dim)" }}> — {props.market.title}</span>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--text-dim)" }}>NO MARKET LOCKED</span>
        )}
      </div>

      <div
        style={{
          color: statusColor(props.relayStatus, props.upstreamStatus),
          fontSize: 11,
          letterSpacing: "0.05em",
        }}
      >
        ● {statusLabel(props.relayStatus, props.upstreamStatus)}
      </div>
    </div>
  );
}
