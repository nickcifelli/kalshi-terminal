import type { ReactNode } from "react";
import type { AnalyticsState } from "../types";

function fmt(n: number | null, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "--";
  return n.toFixed(decimals);
}

function fmtCents(n: number | null, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "--";
  return `${(n * 100).toFixed(decimals)}¢`;
}

function fmtSignedCents(n: number | null, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "--";
  const c = n * 100;
  const sign = c > 0 ? "+" : "";
  return `${sign}${c.toFixed(decimals)}¢`;
}

function fmtPct(n: number | null, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "--";
  return `${(n * 100).toFixed(decimals)}%`;
}

function colorForSigned(n: number | null): string {
  if (n == null) return "var(--text)";
  if (n > 0) return "var(--green)";
  if (n < 0) return "var(--red)";
  return "var(--text-dim)";
}

function Row(props: { label: string; hint?: string; value: string; color?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 12,
        padding: "1px 0",
      }}
    >
      <span style={{ color: "var(--text-dim)" }}>
        {props.label}
        {props.hint && <span style={{ opacity: 0.6 }}> {props.hint}</span>}
      </span>
      <span className="mono-num" style={{ color: props.color ?? "var(--text)" }}>
        {props.value}
      </span>
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          color: "var(--amber)",
          fontSize: 10,
          letterSpacing: "0.08em",
          marginBottom: 3,
        }}
      >
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

export function AnalyticsPanel(props: { analytics: AnalyticsState | null }) {
  const a = props.analytics;
  return (
    <div className="panel" style={{ flex: 1.2, minHeight: 0 }}>
      <div className="panel-title">
        Analytics{a ? ` (${a.windowSec}s window)` : ""}
      </div>
      <div className="panel-body">
        {!a && (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>waiting for data…</div>
        )}
        {a && (
          <>
            <Section title="BOOK">
              <Row label="SPREAD" value={fmtCents(a.spreadDollars, 2)} />
              <Row label="MICROPRICE" value={fmtCents(a.micropriceDollars, 3)} />
              <Row
                label="OBI (TOP)"
                value={fmtPct(a.obiTop)}
                color={colorForSigned(a.obiTop)}
              />
              <Row
                label="OBI (DEPTH)"
                value={fmtPct(a.obiDepth)}
                color={colorForSigned(a.obiDepth)}
              />
              <Row label="BID SLOPE" hint="ct/¢" value={fmt(a.bookSlopeBid, 1)} />
              <Row label="ASK SLOPE" hint="ct/¢" value={fmt(a.bookSlopeAsk, 1)} />
              <Row label="BOOK ENTROPY" value={fmt(a.bookEntropy, 2)} />
            </Section>

            <Section title="FLOW">
              <Row label="OFI" value={fmt(a.ofi, 0)} color={colorForSigned(a.ofi)} />
              <Row label="QUOTE/TRADE" value={fmt(a.quoteToTradeRatio, 1)} />
              <Row label="CANCEL/TRADE" value={fmt(a.cancelToTradeRatio, 1)} />
              <Row label="KYLE'S LAMBDA" value={fmt(a.kyleLambda, 4)} />
            </Section>

            <Section title="EXECUTION">
              <Row label="EFF. SPREAD" value={fmtCents(a.effectiveSpreadDollars, 2)} />
              {a.markouts.map((m) => (
                <Row
                  key={m.horizonSec}
                  label={`MARKOUT ${m.horizonSec}S`}
                  value={m.sampleCount > 0 ? fmtSignedCents(m.avgDollars, 2) : "--"}
                  color={colorForSigned(m.avgDollars)}
                />
              ))}
            </Section>

            <Section title="RISK / MICROSTRUCTURE">
              <Row
                label="REALIZED VOL"
                value={a.realizedVolBps != null ? `${a.realizedVolBps.toFixed(1)} bps` : "--"}
              />
              <Row
                label="AMIHUD ILLIQ."
                value={a.amihud != null ? a.amihud.toExponential(2) : "--"}
              />
              <Row label="VPIN" value={fmt(a.vpin, 2)} />
              <Row
                label="RESILIENCY"
                value={
                  a.resiliencyActive
                    ? "RECOVERING…"
                    : a.resiliencyMs != null
                      ? `${(a.resiliencyMs / 1000).toFixed(1)}s`
                      : "--"
                }
                color={a.resiliencyActive ? "var(--amber)" : undefined}
              />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
