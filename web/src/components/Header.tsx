import { useEffect, useState } from "react";
import type { ConnectionStatus, LockedMarketInfo } from "../types";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const CLOSE_SOON_MS = 5 * 60_000;
const CLOSE_CRITICAL_MS = 60_000;

function timeToClose(
  closeTime: string | null,
  now: number,
): { text: string; urgent: boolean; critical: boolean; closed: boolean } | null {
  if (!closeTime) return null;
  const closeMs = Date.parse(closeTime);
  if (Number.isNaN(closeMs)) return null;

  const remainingMs = closeMs - now;
  if (remainingMs <= 0) {
    return { text: "CLOSED", urgent: true, critical: false, closed: true };
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const text =
    days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : hours > 0
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;

  return {
    text,
    urgent: remainingMs < CLOSE_SOON_MS,
    critical: remainingMs < CLOSE_CRITICAL_MS,
    closed: false,
  };
}

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
  const now = useNow(1000);
  const closeInfo = timeToClose(props.market?.closeTime ?? null, now);

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
            {closeInfo && (
              <span
                className={closeInfo.critical ? "close-badge close-critical" : "close-badge"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  marginLeft: 12,
                  padding: "3px 12px",
                  borderRadius: 3,
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: "0.03em",
                  border: `1px solid ${
                    closeInfo.closed || closeInfo.critical
                      ? "var(--red)"
                      : closeInfo.urgent
                        ? "var(--amber)"
                        : "var(--border)"
                  }`,
                  color:
                    closeInfo.closed || closeInfo.critical
                      ? "var(--red)"
                      : closeInfo.urgent
                        ? "var(--amber)"
                        : "var(--text-dim)",
                  background: closeInfo.critical ? "rgba(255, 77, 77, 0.15)" : "transparent",
                }}
              >
                {closeInfo.closed ? "CLOSED" : `CLOSES IN ${closeInfo.text}`}
              </span>
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
