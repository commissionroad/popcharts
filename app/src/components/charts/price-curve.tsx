"use client";

import { type PointerEvent, useState } from "react";

import type { MarketSide, PricePathPoint } from "@/domain/markets/types";
import { formatPercent } from "@/lib/format";

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 100;
const TRAILING_OPACITY = 0.25;
const INTRADAY_SPAN_MS = 48 * 60 * 60 * 1000;

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});
const DATE_TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

export function PriceCurve({
  points,
  side,
}: {
  points: PricePathPoint[];
  side: MarketSide;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const color = side === "yes" ? "var(--yes)" : "var(--no)";
  const lastIndex = Math.max(points.length - 1, 1);
  const hoverable = points.length > 1;
  const hovered = hoverIndex === null ? null : points[hoverIndex];

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!hoverable) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width === 0) {
      return;
    }

    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setHoverIndex(Math.round(fraction * lastIndex));
  }

  return (
    <div
      className="relative"
      data-testid="price-curve"
      onPointerLeave={() => setHoverIndex(null)}
      onPointerMove={handlePointerMove}
    >
      <svg
        aria-label="Virtual LMSR implied probability path"
        className="h-[150px] w-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        <defs>
          <linearGradient id={`curve-fill-${side}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          fill={`url(#curve-fill-${side})`}
          points={`${svgPoints(points, 0, points.length)} ${VIEW_WIDTH},${VIEW_HEIGHT} 0,${VIEW_HEIGHT}`}
        />
        <polyline
          fill="none"
          points={svgPoints(
            hoverIndex === null ? points : points.slice(0, hoverIndex + 1),
            0,
            points.length
          )}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
        {hoverIndex !== null && hoverIndex < points.length - 1 ? (
          <polyline
            fill="none"
            points={svgPoints(points.slice(hoverIndex), hoverIndex, points.length)}
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={TRAILING_OPACITY}
            strokeWidth="2.5"
          />
        ) : null}
      </svg>
      {hovered && hoverIndex !== null ? (
        <HoverMarker
          color={color}
          point={hovered}
          timeLabel={hoverTimeLabel(points, hovered)}
          xPct={(hoverIndex / lastIndex) * 100}
        />
      ) : null}
    </div>
  );
}

/**
 * Cursor rail, snapped dot, and value readout for the hovered sample. Drawn as
 * an HTML overlay instead of SVG children so the non-uniform SVG scaling never
 * distorts the dot or the label text.
 */
function HoverMarker({
  color,
  point,
  timeLabel,
  xPct,
}: {
  color: string;
  point: PricePathPoint;
  timeLabel: string | null;
  xPct: number;
}) {
  const yPct = 100 - clamp(point.cents, 0, 100);
  const nearRightEdge = xPct > 82;
  const nearTopEdge = yPct < 30;

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
        style={{ left: `${xPct}%` }}
      />
      <div
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--surface-card)]"
        style={{ borderColor: color, left: `${xPct}%`, top: `${yPct}%` }}
      />
      <div
        className="absolute z-10"
        style={{
          left: `${xPct}%`,
          top: `${yPct}%`,
          transform: `translate(${nearRightEdge ? "calc(-100% - 10px)" : "10px"}, ${
            nearTopEdge ? "10px" : "calc(-100% - 10px)"
          })`,
        }}
      >
        <div className="flex items-baseline gap-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1.5 whitespace-nowrap">
          <span className="font-display text-sm font-black" style={{ color }}>
            {formatPercent(point.cents)}
          </span>
          {timeLabel ? (
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {timeLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function svgPoints(points: PricePathPoint[], startIndex: number, total: number) {
  return points
    .map((point, index) => {
      const x = ((startIndex + index) / Math.max(total - 1, 1)) * VIEW_WIDTH;
      const y = VIEW_HEIGHT - point.cents;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Formats the hovered sample's timestamp, including the time of day only when
 * the whole path spans less than two days — mirroring how axis labels tighten
 * on intraday charts.
 */
function hoverTimeLabel(points: PricePathPoint[], hovered: PricePathPoint) {
  if (!hovered.at) {
    return null;
  }

  const hoveredMs = Date.parse(hovered.at);

  if (Number.isNaN(hoveredMs)) {
    return null;
  }

  const timestamps = points
    .map((point) => (point.at ? Date.parse(point.at) : Number.NaN))
    .filter((value) => !Number.isNaN(value));
  const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
  const formatter =
    spanMs < INTRADAY_SPAN_MS ? DATE_TIME_LABEL_FORMATTER : DATE_LABEL_FORMATTER;

  return formatter.format(hoveredMs);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
