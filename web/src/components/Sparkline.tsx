import { useMemo, useRef, useState } from "react";

export interface SparklinePoint {
  x: number;
  y: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  color?: string;
  diverging?: boolean;
  positiveColor?: string;
  negativeColor?: string;
  interactive?: boolean;
  formatValue?: (y: number) => string;
  formatTime?: (x: number) => string;
}

const PAD = 5;

export function Sparkline(props: SparklineProps) {
  const {
    data,
    width = 220,
    height = 48,
    color = "var(--cyan)",
    diverging = false,
    positiveColor = "var(--green)",
    negativeColor = "var(--red)",
    interactive = false,
    formatValue = (y: number) => y.toFixed(2),
    formatTime = (x: number) => new Date(x).toLocaleTimeString([], { hour12: false }),
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (data.length < 2) return null;

    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const xMin = xs[0];
    const xMax = xs[xs.length - 1];
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const domainMax = diverging
      ? Math.max(Math.abs(yMin), Math.abs(yMax), 1e-9)
      : null;
    const yLo = diverging ? -domainMax! : yMin;
    const yHi = diverging ? domainMax! : yMax;
    const ySpan = yHi - yLo || 1;
    const xSpan = xMax - xMin || 1;

    const scaleX = (x: number) => PAD + ((x - xMin) / xSpan) * (width - PAD * 2);
    const scaleY = (y: number) => height - PAD - ((y - yLo) / ySpan) * (height - PAD * 2);

    const points = data.map((d) => ({ ...d, px: scaleX(d.x), py: scaleY(d.y) }));
    const baselineY = diverging ? scaleY(0) : null;

    return { points, baselineY };
  }, [data, width, height, diverging]);

  if (!geometry) {
    return <div style={{ width, height }} />;
  }

  const { points, baselineY } = geometry;
  const last = points[points.length - 1];
  const lastColor = diverging ? (last.y >= 0 ? positiveColor : negativeColor) : color;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const localX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.px - localX);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const hoveredColor = hovered
    ? diverging
      ? hovered.y >= 0
        ? positiveColor
        : negativeColor
      : color
    : lastColor;

  return (
    <div style={{ position: "relative", width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
        style={{ display: "block", cursor: interactive ? "crosshair" : "default" }}
      >
        {baselineY != null && (
          <line
            x1={0}
            y1={baselineY}
            x2={width}
            y2={baselineY}
            stroke="var(--border)"
            strokeWidth={1}
          />
        )}

        {!diverging && (
          <path
            d={`M${points[0].px},${points[0].py} ${points
              .slice(1)
              .map((p) => `L${p.px},${p.py}`)
              .join(" ")} L${last.px},${height - PAD} L${points[0].px},${height - PAD} Z`}
            fill={color}
            opacity={0.1}
          />
        )}

        {diverging
          ? points.slice(1).map((p, i) => {
              const prev = points[i];
              const segColor = p.y >= 0 ? positiveColor : negativeColor;
              return (
                <line
                  key={p.x}
                  x1={prev.px}
                  y1={prev.py}
                  x2={p.px}
                  y2={p.py}
                  stroke={segColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })
          : (
              <path
                d={`M${points[0].px},${points[0].py} ${points
                  .slice(1)
                  .map((p) => `L${p.px},${p.py}`)
                  .join(" ")}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

        {interactive && hovered && (
          <line
            x1={hovered.px}
            y1={0}
            x2={hovered.px}
            y2={height}
            stroke="var(--text-dim)"
            strokeWidth={1}
            opacity={0.5}
          />
        )}

        <circle
          cx={hovered ? hovered.px : last.px}
          cy={hovered ? hovered.py : last.py}
          r={4}
          fill={hoveredColor}
          stroke="var(--panel-bg)"
          strokeWidth={2}
        />

        {interactive && hovered && (() => {
          const boxWidth = 72;
          const boxHeight = 26;
          const bx = Math.min(Math.max(hovered.px - boxWidth / 2, 2), width - boxWidth - 2);
          const by = 3;
          return (
            <g pointerEvents="none">
              <rect
                x={bx}
                y={by}
                width={boxWidth}
                height={boxHeight}
                rx={2}
                fill="var(--panel-bg)"
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={bx + boxWidth / 2}
                y={by + 11}
                textAnchor="middle"
                fontSize={9}
                fontFamily="var(--mono)"
                fill="var(--text-dim)"
              >
                {formatTime(hovered.x)}
              </text>
              <text
                x={bx + boxWidth / 2}
                y={by + 22}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fontFamily="var(--mono)"
                fill={hoveredColor}
              >
                {formatValue(hovered.y)}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
