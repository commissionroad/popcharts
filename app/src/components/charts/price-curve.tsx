"use client";

import { type PointerEvent, useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import type { PostgradPricePoint, PricePathPoint } from "@/domain/markets/types";
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

/** Which trading mechanism produced a price. */
export type CurvePhase = "postgrad" | "pregrad";

/**
 * A price sample normalized across both trading phases, before windowing.
 * Carries both outcomes explicitly because only the pre-graduation half is
 * complementary — see {@link PostgradPricePoint}.
 */
export type CurvePoint = {
  at?: string;
  noCents: number;
  phase: CurvePhase;
  yesCents: number;
};

/** One plot-ready sample: x runs 0..1 across the selected window. */
export type ChartSample = {
  atMs: number | null;
  noCents: number;
  phase: CurvePhase;
  x: number;
  yesCents: number;
};

/**
 * A windowed path plus the wall-clock bounds it was plotted against. The
 * bounds are what place a dated annotation — the graduation rule — on the same
 * x scale as the samples; they are null when the path has no usable
 * timestamps and samples fall back to even index spacing.
 */
export type ChartWindow = {
  samples: ChartSample[];
  timeSpan: { spanMs: number; startMs: number } | null;
};

/**
 * Normalizes a market's two price sources into one chronological path. The
 * pre-graduation LMSR path prices YES and infers NO as its complement; the
 * post-graduation venue path prices each pool independently.
 */
export function toCurvePoints({
  points,
  postgradPoints = [],
}: {
  points: PricePathPoint[];
  postgradPoints?: PostgradPricePoint[];
}): CurvePoint[] {
  return [
    ...points.map((point) => ({
      ...(point.at === undefined ? {} : { at: point.at }),
      noCents: 100 - point.cents,
      phase: "pregrad" as const,
      yesCents: point.cents,
    })),
    ...postgradPoints.map((point) => ({
      at: point.at,
      noCents: point.noCents,
      phase: "postgrad" as const,
      yesCents: point.yesCents,
    })),
  ];
}

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
  points: CurvePoint[],
  rangeMs: number | null
): ChartWindow {
  // Destructured rather than spread whole: `at` is replaced by `atMs` here, and
  // carrying both would leave every sample with two spellings of its timestamp.
  const timed = points.map(({ at, ...rest }) => ({
    ...rest,
    atMs: at ? Date.parse(at) : Number.NaN,
  }));
  const hasTimestamps =
    timed.length > 0 && timed.every((point) => Number.isFinite(point.atMs));

  if (!hasTimestamps) {
    const lastIndex = Math.max(points.length - 1, 1);

    return {
      samples: timed.map((point, index) => ({
        ...point,
        atMs: null,
        x: index / lastIndex,
      })),
      timeSpan: null,
    };
  }

  const firstMs = timed[0]!.atMs;
  const endMs = timed[timed.length - 1]!.atMs;
  const startMs = rangeMs === null ? firstMs : Math.max(endMs - rangeMs, firstMs);
  const spanMs = endMs - startMs;

  if (spanMs <= 0) {
    const lastIndex = Math.max(timed.length - 1, 1);

    return {
      samples: timed.map((point, index) => ({
        ...point,
        x: index / lastIndex,
      })),
      timeSpan: null,
    };
  }

  const visible = timed.filter((point) => point.atMs >= startMs);
  const anchor = timed.filter((point) => point.atMs < startMs).at(-1);
  const windowed = anchor ? [{ ...anchor, atMs: startMs }, ...visible] : visible;

  return {
    samples: windowed.map((point) => ({
      ...point,
      x: (point.atMs - startMs) / spanMs,
    })),
    timeSpan: { spanMs, startMs },
  };
}

/**
 * Where the graduation moment falls on the plotted x scale, or null when it
 * cannot be placed: an untimed path, an unknown graduation time, or a
 * graduation that postdates every plotted sample. The result is deliberately
 * *not* clamped — a negative x means the whole visible window is
 * post-graduation, which the caller renders as a fully shaded region with no
 * rule rather than a rule pinned to the left edge.
 */
export function graduationOffset(
  chartWindow: ChartWindow,
  graduatedAt: string | undefined
): number | null {
  if (graduatedAt === undefined || chartWindow.timeSpan === null) {
    return null;
  }

  const graduatedAtMs = Date.parse(graduatedAt);

  if (!Number.isFinite(graduatedAtMs)) {
    return null;
  }

  const { spanMs, startMs } = chartWindow.timeSpan;
  const offset = (graduatedAtMs - startMs) / spanMs;

  return offset > 1 ? null : offset;
}

/**
 * Market price history in the Polymarket idiom: YES and NO series over a
 * selectable trailing window, dotted quarter gridlines with axis values, and
 * a crosshair hover that pins both series' values and the sample's timestamp.
 * Outcome labels default to YES/NO; pass the market's creator-applied labels
 * to respect them.
 *
 * One chart spans a market's whole trading life. Before graduation the series
 * are the virtual LMSR's implied probabilities; after it they are the traded
 * prices of the two bounded venue pools. Passing `postgradPoints` and
 * `graduatedAt` draws the second half plus the rule that separates them, so
 * the mechanism change is visible instead of being hidden inside one
 * continuous line. Both are optional: a market that has not graduated renders
 * exactly as before.
 */
export function PriceCurve({
  graduatedAt,
  noLabel = "NO",
  points,
  postgradPoints,
  yesLabel = "YES",
}: {
  /** ISO time the market graduated, when it has. */
  graduatedAt?: string;
  noLabel?: string;
  points: PricePathPoint[];
  postgradPoints?: PostgradPricePoint[];
  yesLabel?: string;
}) {
  const [range, setRange] = useState<ChartRange>("ALL");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const curvePoints = toCurvePoints({
    points,
    ...(postgradPoints === undefined ? {} : { postgradPoints }),
  });
  const hasTimestamps =
    curvePoints.length > 0 && curvePoints.every((point) => point.at !== undefined);
  const rangeMs = CHART_RANGES.find((option) => option.label === range)?.ms ?? null;
  // Not named `window`: this is a client component, where that shadows the DOM
  // global.
  const chartWindow = windowPricePath(curvePoints, hasTimestamps ? rangeMs : null);
  const { samples } = chartWindow;
  const graduation = graduationOffset(chartWindow, graduatedAt);
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
          value={readout ? formatPercent(readout.yesCents) : null}
        />
        <LegendChip
          color="var(--no)"
          label={noLabel}
          testId="legend-no-value"
          value={readout ? formatPercent(readout.noCents) : null}
        />
      </div>

      <div
        className="relative"
        data-testid="price-curve-plot"
        onPointerLeave={() => setHoverIndex(null)}
        onPointerMove={handlePointerMove}
      >
        {/* The post-graduation stretch, shaded before the gridlines and series
            so it reads as the backdrop those are drawn on. A neutral raised
            surface rather than a tint: cyan, lime and magenta are all spoken
            for by the rule and the two series. */}
        {graduation !== null && graduation < 1 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 bg-[var(--surface-hover)] opacity-60"
            data-testid="postgrad-region"
            style={{ left: `${clamp(graduation, 0, 1) * 100}%` }}
          />
        ) : null}
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
          // `relative` only to position it: an absolutely positioned sibling
          // (the post-graduation shading) paints above a static one whatever
          // the DOM order, which would otherwise mute the series behind it.
          className="relative h-[170px] w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        >
          <polyline
            fill="none"
            points={svgPoints(samples, (sample) => sample.yesCents)}
            stroke="var(--yes)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <polyline
            fill="none"
            points={svgPoints(samples, (sample) => sample.noCents)}
            stroke="var(--no)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
        {graduation !== null && graduation >= 0 ? (
          <GraduationRule offset={graduation} />
        ) : null}
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
 * The moment the market handed off from the virtual LMSR to the bounded venue.
 * Dashed so it never reads as a third data series, and cyan because both
 * series colours (lime YES, magenta NO) are taken — a lime rule would look
 * like part of the YES line. The label flips to the left of the rule once the
 * rule is far enough right that it would otherwise overflow the plot.
 */
function GraduationRule({ offset }: { offset: number }) {
  const xPct = offset * 100;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-testid="graduation-marker"
    >
      <div
        className="absolute inset-y-0 border-l border-dashed border-[var(--pc-cyan)] opacity-70"
        style={{ left: `${xPct}%` }}
      />
      <span
        className="absolute top-0 rounded-[var(--radius-pill)] border border-[var(--pc-cyan)] bg-[var(--surface-card)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] whitespace-nowrap text-[var(--pc-cyan)] uppercase"
        style={{
          left: `${xPct}%`,
          transform: xPct > 60 ? "translateX(calc(-100% - 4px))" : "translateX(4px)",
        }}
      >
        Graduated
      </span>
    </div>
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
        yPct={100 - clamp(sample.yesCents, 0, 100)}
      />
      <SeriesDot
        color="var(--no)"
        xPct={xPct}
        yPct={100 - clamp(sample.noCents, 0, 100)}
      />
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
            value={formatPercent(sample.yesCents)}
          />
          <TooltipRow
            color="var(--no)"
            label={noLabel}
            value={formatPercent(sample.noCents)}
          />
          {/* Post-graduation the two pools price independently, so their sum
              is the live complete-set price rather than a constant 100% — the
              gap is the arbitrage on offer, and it is the one number the
              pre-graduation readout cannot show. */}
          {sample.phase === "postgrad" ? (
            <TooltipRow
              color="var(--text-muted)"
              label="Set"
              value={formatPercent(sample.yesCents + sample.noCents)}
            />
          ) : null}
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

function svgPoints(samples: ChartSample[], toValue: (sample: ChartSample) => number) {
  const drawable =
    samples.length === 1 && samples[0]
      ? [samples[0], { ...samples[0], x: 1 }]
      : samples;

  return drawable
    .map((sample) => {
      const x = sample.x * VIEW_WIDTH;
      const y = VIEW_HEIGHT - toValue(sample);
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
