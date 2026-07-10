import { useState } from "react";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import { Header } from "./components/Header";
import { MarketPicker } from "./components/MarketPicker";
import { OrderbookPanel } from "./components/OrderbookPanel";
import { PricePanel } from "./components/PricePanel";
import { TradesPanel } from "./components/TradesPanel";
import { useTerminalSocket } from "./hooks/useTerminalSocket";

export default function App() {
  const state = useTerminalSocket();
  const [screen, setScreen] = useState<"picker" | "terminal">("picker");

  const lockAndShowTerminal = (ticker: string) => {
    state.lock(ticker);
    setScreen("terminal");
  };

  if (screen === "picker") {
    return (
      <MarketPicker
        topMarkets={state.topMarkets}
        relayStatus={state.relayStatus}
        onLock={lockAndShowTerminal}
      />
    );
  }

  return (
    <div className="term">
      <Header
        relayStatus={state.relayStatus}
        upstreamStatus={state.upstreamStatus}
        market={state.market}
        onLock={lockAndShowTerminal}
        onChangeMarket={() => setScreen("picker")}
      />

      {state.upstreamError && (
        <div style={{ color: "var(--red)", fontSize: 12, padding: "4px 10px" }}>
          ERROR: {state.upstreamError}
        </div>
      )}

      <PricePanel ticker={state.ticker} />

      <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0 }}>
        <OrderbookPanel orderbook={state.orderbook} />
        <TradesPanel trades={state.trades} />
        <AnalyticsPanel analytics={state.analytics} />
      </div>
    </div>
  );
}
