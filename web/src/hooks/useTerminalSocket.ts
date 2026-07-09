import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionStatus,
  LockedMarketInfo,
  OrderbookState,
  TickerState,
  TradeEvent,
} from "../types";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8787";
const MAX_TRADES = 40;
const RECONNECT_DELAY_MS = 2000;

export interface TerminalState {
  relayStatus: "connecting" | "open" | "closed";
  upstreamStatus: ConnectionStatus | null;
  upstreamError: string | null;
  market: LockedMarketInfo | null;
  ticker: TickerState | null;
  orderbook: OrderbookState | null;
  trades: TradeEvent[];
  lock: (ticker: string) => void;
}

export function useTerminalSocket(): TerminalState {
  const [relayStatus, setRelayStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [upstreamStatus, setUpstreamStatus] = useState<ConnectionStatus | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [market, setMarket] = useState<LockedMarketInfo | null>(null);
  const [ticker, setTicker] = useState<TickerState | null>(null);
  const [orderbook, setOrderbook] = useState<OrderbookState | null>(null);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingLockRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      setRelayStatus("connecting");
      const socket = new WebSocket(RELAY_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setRelayStatus("open");
        if (pendingLockRef.current) {
          socket.send(JSON.stringify({ type: "lock", ticker: pendingLockRef.current }));
        }
      });

      socket.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "status":
            setUpstreamStatus(msg.status);
            setUpstreamError(msg.upstreamError ?? null);
            break;
          case "locked":
            setMarket(msg.market);
            setTicker(null);
            setOrderbook(null);
            setTrades([]);
            break;
          case "ticker":
            setTicker(msg.data);
            break;
          case "orderbook":
            setOrderbook(msg.data);
            break;
          case "trade":
            setTrades((prev) => [msg.data, ...prev].slice(0, MAX_TRADES));
            break;
          case "error":
            setUpstreamError(msg.message);
            break;
        }
      });

      socket.addEventListener("close", () => {
        setRelayStatus("closed");
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const lock = useCallback((tickerSymbol: string) => {
    const normalized = tickerSymbol.trim().toUpperCase();
    if (!normalized) return;
    pendingLockRef.current = normalized;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "lock", ticker: normalized }));
    }
  }, []);

  return { relayStatus, upstreamStatus, upstreamError, market, ticker, orderbook, trades, lock };
}
