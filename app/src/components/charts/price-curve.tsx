"use client";

import { type PointerEvent, useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import type { PricePathPoint } from "@/domain/markets/types";
import { formatPercent } from "@/lib/format";

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 100;
const INTRADAY_SPAN_MS = 48 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const GRID_LEVELS = [25, 50, 75, 100];
const X_TICK_FRACTIONS = [0, 1 / 3, 2 / 3, 1];

export type ChartRange = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

export const CHART_RANGES: Array<{ label: ChartRange; ms: number | null }> = [
  { label: "1H", ms: HOUR_MS },
  { label: "6H", ms: 6 * HOUR_MS },
  { label: "1D", ms: DAY_MS },
  { label: "1W", ms: 7 * DAY_MS },
  { label: "1M", ms: 30 * DAY_MS },
  { label: "ALL", ms: null },
];

/** One plot-ready sample: x runs 0..1 across the selected window. */
export type ChartSample = {
  atMs: number | null;
  cents: number;
  x: number;
};

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});
const TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const DATE_TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});

/**
 * Windows a price path to the trailing `rangeMs` before its latest sample and
 * maps each point to an x fraction. With a null range (ALL) the window covers
 * the whole path. The point just before the window start, when one exists, is
 * carried in as an anchor sample at the window's left edge so the line enters
 * the chart at the price that was standing there. Paths without complete
 * timestamps fall back to even index spacing over the full history.
 */
export function windowPricePath(
  points: PricePathPoint[],
  rangeMs: number | null
): ChartSample[] {
  const timed = points.map((point) => ({
    atMs: point.at ? Date.parse(point.at) : Number.NaN,
    cents: point.cents,
  }));
  const hasTimestamps =
    timed.length > 0 && timed.every((point) => Number.isFinite(point.atMs));

  if (!hasTimestamps) {
    const lastIndex = Math.max(points.length - 1, 1);

    return points.map((point, index) => ({
      atMs: null,
      cents: point.cents,
      x: index / lastIndex,
    }));
  }

  const firstMs = timed[0]!.atMs;
  const endMs = timed[timed.length - 1]!.atMs;
  const startMs = rangeMs === null ? firstMs : Math.max(endMs - rangeMs, firstMs);
  const spanMs = endMs - startMs;

  if (spanMs <= 0) {
    const lastIndex = Math.max(timed.length - 1, 1);

    return timed.map((point, index) => ({
      atMs: point.atMs,
      cents: point.cents,
      x: index / lastIndex,
    }));
  }

  const visible = timed.filter((point) => point.atMs >= startMs);
  const anchor = timed.filter((point) => point.atMs < startMs).at(-1);
  const windowed = anchor
    ? [{ atMs: startMs, cents: anchor.cents }, ...visible]
    : visible;

  return windowed.map((point) => ({
    atMs: point.atMs,
    cents: point.cents,
    x: (point.atMs - startMs) / spanMs,
  }));
}

/**
 * Market price history in the Polymarket idiom: YES and NO series over a
 * selectable trailing window, dotted quarter gridlines with axis values, and
 * a crosshair hover that pins both series' values and the sample's timestamp.
 * Outcome labels default to YES/NO; pass the market's creator-applied labels
 * to respect them.
 */
export function PriceCurve({
  noLabel = "NO",
  points,
  yesLabel = "YES",
}: {
  noLabel?: string;
  points: PricePathPoint[];
  yesLabel?: string;
}) {
  const [range, setRange] = useState<ChartRange>("ALL");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const hasTimestamps =
    points.length > 0 && points.every((point) => point.at !== undefined);
  const rangeMs = CHART_RANGES.find((option) => option.label === range)?.ms ?? null;
  const samples = windowPricePath(points, hasTimestamps ? rangeMs : null);
  const hoverable = samples.length > 1;
  const hovered = hoverIndex === null ? null : samples[hoverIndex];
  const readout = hovered ?? samples.at(-1);
  const intraday = sampleSpanMs(samples) < INTRADAY_SPAN_MS;

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!hoverable) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width === 0) {
      return;
    }

    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setHoverIndex(nearestSampleIndex(samples, fraction));
  }

  return (
    <div data-testid="price-curve">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <LegendChip
          color="var(--yes)"
          label={yesLabel}
          testId="legend-yes-value"
          value={readout ? formatPercent(readout.cents) : null}
        />
        <LegendChip
          color="var(--no)"
          label={noLabel}
          testId="legend-no-value"
          value={readout ? formatPercent(100 - readout.cents) : null}
        />
      </div>

      <div
        className="relative"
        data-testid="price-curve-plot"
        onPointerLeave={() => setHoverIndex(null)}
        onPointerMove={handlePointerMove}
      >
        {GRID_LEVELS.map((level) => (
          <div
            className="pointer-events-none absolute inset-x-0"
            key={level}
            style={{ top: `${100 - level}%` }}
          >
            <div className="border-t border-dotted border-[var(--border-soft)] opacity-60" />
            <span className="absolute top-0.5 right-0 font-mono text-[9px] text-[var(--text-muted)] opacity-80">
              {level}%
            </span>
          </div>
        ))}
        <svg
          aria-label="Implied probability history for both outcomes"
          className="h-[170px] w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          <polyline
            fill="none"
            points={svgPoints(samples, (cents) => cents)}
            stroke="var(--yes)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <polyline
            fill="none"
            points={svgPoints(samples, (cents) => 100 - cents)}
            stroke="var(--no)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        {hovered ? (
          <HoverMarker
            intraday={intraday}
            noLabel={noLabel}
            sample={hovered}
            yesLabel={yesLabel}
          />
        ) : null}
      </div>

      {hasTimestamps ? (
        <div className="relative mt-1 h-4">
          {xTickLabels(samples, intraday).map((tick) => (
            <span
              className="absolute top-0 font-mono text-[9px] whitespace-nowrap text-[var(--text-muted)]"
              key={tick.fraction}
              style={{
                left: `${tick.fraction * 100}%`,
                transform:
                  tick.fraction === 0
                    ? undefined
                    : tick.fraction === 1
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      ) : null}

      {hasTimestamps ? (
        <div className="mt-3">
          <SegmentedControl
            onChange={(value) => {
              setHoverIndex(null);
              setRange(value as ChartRange);
            }}
            options={CHART_RANGES.map(({ label }) => ({ label, value: label }))}
            size="sm"
            value={range}
          />
        </div>
      ) : null}
    </div>
  );
}

function LegendChip({
  color,
  label,
  testId,
  value,
}: {
  color: string;
  label: string;
  testId: string;
  value: string | null;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        aria-hidden
        className="size-2 self-center rounded-full"
        style={{ background: color }}
      />
      <span className="font-mono text-[11px] font-bold text-[var(--text-secondary)]">
        {label}
      </span>
      {value ? (
        <span
          className="font-display tabular text-sm font-black"
          data-testid={testId}
          style={{ color }}
        >
          {value}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Crosshair rail with a snapped dot per series and a pinned readout of both
 * outcomes at the hovered sample. Drawn as an HTML overlay instead of SVG
 * children so the non-uniform SVG scaling never distorts the dots or text.
 */
function HoverMarker({
  intraday,
  noLabel,
  sample,
  yesLabel,
}: {
  intraday: boolean;
  noLabel: string;
  sample: ChartSample;
  yesLabel: string;
}) {
  const xPct = sample.x * 100;
  const nearRightEdge = xPct > 60;
  const timeLabel =
    sample.atMs === null
      ? null
      : (intraday ? DATE_TIME_LABEL_FORMATTER : DATE_LABEL_FORMATTER).format(
          sample.atMs
        );

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="crosshair">
      <div
        className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
        style={{ left: `${xPct}%` }}
      />
      <SeriesDot
        color="var(--yes)"
        xPct={xPct}
        yPct={100 - clamp(sample.cents, 0, 100)}
      />
      <SeriesDot color="var(--no)" xPct={xPct} yPct={clamp(sample.cents, 0, 100)} />
      <div
        className="absolute top-1 z-10"
        style={{
          left: `${xPct}%`,
          transform: nearRightEdge
            ? "translateX(calc(-100% - 10px))"
            : "translateX(10px)",
        }}
      >
        <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1.5 whitespace-nowrap">
          {timeLabel ? (
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {timeLabel}
            </span>
          ) : null}
          <TooltipRow
            color="var(--yes)"
            label={yesLabel}
            value={formatPercent(sample.cents)}
          />
          <TooltipRow
            color="var(--no)"
            label={noLabel}
            value={formatPercent(100 - sample.cents)}
          />
        </div>
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        aria-hidden
        className="size-1.5 self-center rounded-full"
        style={{ background: color }}
      />
      <span className="max-w-40 truncate font-mono text-[10px] text-[var(--text-secondary)]">
        {label}
      </span>
      <span
        className="font-display ml-auto text-xs font-black tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
    </span>
  );
}

function SeriesDot({
  color,
  xPct,
  yPct,
}: {
  color: string;
  xPct: number;
  yPct: number;
}) {
  return (
    <div
      className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--surface-card)]"
      style={{ borderColor: color, left: `${xPct}%`, top: `${yPct}%` }}
    />
  );
}

function svgPoints(samples: ChartSample[], toValue: (cents: number) => number) {
  const drawable =
    samples.length === 1 && samples[0]
      ? [samples[0], { ...samples[0], x: 1 }]
      : samples;

  return drawable
    .map((sample) => {
      const x = sample.x * VIEW_WIDTH;
      const y = VIEW_HEIGHT - toValue(sample.cents);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function nearestSampleIndex(samples: ChartSample[], fraction: number) {
  let nearest = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const candidate = samples[nearest];

    if (
      sample &&
      candidate &&
      Math.abs(sample.x - fraction) < Math.abs(candidate.x - fraction)
    ) {
      nearest = index;
    }
  }

  return nearest;
}

function sampleSpanMs(samples: ChartSample[]) {
  const first = samples.find((sample) => sample.atMs !== null);
  const last = samples.findLast((sample) => sample.atMs !== null);

  if (!first || !last || first.atMs === null || last.atMs === null) {
    return Number.POSITIVE_INFINITY;
  }

  return last.atMs - first.atMs;
}

/**
 * Evenly spaced time labels across the visible window, formatted as
 * times-of-day for intraday windows and month-day dates otherwise.
 */
function xTickLabels(samples: ChartSample[], intraday: boolean) {
  const first = samples.find((sample) => sample.atMs !== null);
  const last = samples.findLast((sample) => sample.atMs !== null);

  if (!first || !last || first.atMs === null || last.atMs === null) {
    return [];
  }

  const startMs = first.atMs;
  const spanMs = last.atMs - startMs;

  if (spanMs <= 0) {
    return [];
  }

  const formatter = intraday ? TIME_LABEL_FORMATTER : DATE_LABEL_FORMATTER;

  return X_TICK_FRACTIONS.map((fraction) => ({
    fraction,
    label: formatter.format(startMs + fraction * spanMs),
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
