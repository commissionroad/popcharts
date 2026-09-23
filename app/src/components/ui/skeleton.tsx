import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Which surface the skeleton is drawn on. Pop Charts stacks three greys —
 * page ink, card, raised — so a placeholder tinted for one ground disappears
 * on the other. `page` is for skeletons standing directly on the page
 * background (they stand in for cards, so they tint like one); `card` is for
 * skeletons inside a card, which is most of them.
 */
export type SkeletonGround = "page" | "card";

type SkeletonRadius = "none" | "sm" | "md" | "lg" | "pill";

const radiusClasses: Record<SkeletonRadius, string> = {
  lg: "rounded-[var(--radius-lg)]",
  md: "rounded-[var(--radius-md)]",
  none: "",
  pill: "rounded-[var(--radius-pill)]",
  sm: "rounded-[var(--radius-sm)]",
};

/**
 * The ground knobs consumed by `.pc-skeleton` in `globals.css`. Set as custom
 * properties rather than as classes so the shimmer keyframes, timing, and
 * reduced-motion fallback stay defined exactly once.
 */
const groundStyles: Record<SkeletonGround, CSSProperties> = {
  card: {
    "--pc-skeleton-sheen": "var(--surface-hover)",
    "--pc-skeleton-tint": "var(--surface-raised)",
  } as CSSProperties,
  page: {
    "--pc-skeleton-sheen": "var(--surface-raised)",
    "--pc-skeleton-tint": "var(--surface-card)",
  } as CSSProperties,
};

/**
 * One shimmering placeholder rectangle — the block every other skeleton is
 * built from. Size it to the element it replaces: a skeleton that is not the
 * shape of its content reflows the page when the content lands, which is the
 * one thing a skeleton is supposed to prevent over a spinner.
 *
 * Decorative by design. Screen readers should hear "loading" once from the
 * surrounding `SkeletonRegion`, not a shape per placeholder, so every piece
 * here is `aria-hidden`.
 */
export function Skeleton({
  className,
  ground = "card",
  height,
  radius = "sm",
  style,
  width,
}: {
  className?: string;
  ground?: SkeletonGround;
  /** CSS length. Numbers are px. */
  height?: number | string;
  radius?: SkeletonRadius;
  style?: CSSProperties;
  /** CSS length. Numbers are px. */
  width?: number | string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("pc-skeleton", radiusClasses[radius], className)}
      style={{ ...groundStyles[ground], height, width, ...style }}
    />
  );
}

/**
 * A placeholder whose height comes from the type it replaces rather than from
 * a measured pixel value: it carries the real element's own font and box
 * classes and holds a zero-width space, so the browser computes the same line
 * box the real text would occupy. Only the width is invented.
 *
 * This is what keeps the shape-matching claim true as the type scale moves —
 * a hard-coded height silently stops matching the moment someone changes a
 * font size, and the mismatch shows up as a page jump rather than as a failing
 * test.
 */
function SkeletonTypeLine({
  className,
  ground = "card",
  width,
}: {
  /** The real element's type and box classes, verbatim. */
  className: string;
  ground?: SkeletonGround;
  width: number | string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Block, not inline-block: a block establishes its own line box, so
        // the height is exactly this element's line-height. An inline-block
        // additionally inherits the parent's strut and comes out taller than
        // the text it stands in for.
        "pc-skeleton block rounded-[var(--radius-pill)] border-transparent",
        className
      )}
      style={{ ...groundStyles[ground], width }}
    >
      {/* Zero-width space: establishes the line box, paints nothing. */}
      &#8203;
    </span>
  );
}

/**
 * A run of text lines. `lineHeight` should match the real type size this
 * stands in for, and the last line is deliberately short so a paragraph reads
 * as a paragraph rather than as a stack of bars.
 */
export function SkeletonText({
  className,
  gap = 8,
  ground = "card",
  lastLineWidth = "62%",
  lineHeight = 12,
  lines = 3,
}: {
  className?: string;
  /** Gap between lines, in px. */
  gap?: number;
  ground?: SkeletonGround;
  /** Width of the final line. Ignored when `lines` is 1. */
  lastLineWidth?: number | string;
  /** Height of one line, in px — match the type size being replaced. */
  lineHeight?: number;
  lines?: number;
}) {
  return (
    <div className={cn("flex flex-col", className)} style={{ gap }}>
      {Array.from({ length: lines }, (_unused, index) => (
        <Skeleton
          ground={ground}
          height={lineHeight}
          key={index}
          radius="pill"
          width={index === lines - 1 && lines > 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}

const METRIC_LABEL_CLASS = "font-mono text-[10px] tracking-[0.08em]";
const METRIC_VALUE_CLASS = "font-display tabular text-[22px] font-black";

/**
 * Stands in for a `MetricCard` — the icon-plus-label-plus-figure tile used
 * across the portfolio summary row. Real card chrome (border, surface,
 * padding) with only the contents shimmering: chrome that is already known
 * should be drawn, not guessed at.
 */
export function SkeletonMetricCard() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4"
    >
      <Skeleton height={20} radius="sm" width={20} />
      <div className="flex-1">
        <div>
          <SkeletonTypeLine className={METRIC_LABEL_CLASS} width="55%" />
        </div>
        <div className="mt-1">
          <SkeletonTypeLine className={METRIC_VALUE_CLASS} width="70%" />
        </div>
      </div>
    </div>
  );
}

/**
 * Stands in for a `MarketCard` on the discovery board. It reuses the card's
 * own layout classes — `min-h-[360px]`, the `min-h-[76px]` two-line question
 * box, the `flex-1` outcome cells — rather than guessing at pixel heights, so
 * the grid does not jump when the real cards arrive.
 */
export function SkeletonMarketCard() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[360px] flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6"
    >
      {/* The category and status pills, at the pills' own padded height. */}
      <div className="flex items-center justify-between gap-3">
        <SkeletonTypeLine className={PILL_CLASS} width={84} />
        <SkeletonTypeLine className={PILL_CLASS} width={104} />
      </div>

      <div className="min-h-[76px]">
        <SkeletonText lastLineWidth="72%" lineHeight={18} lines={2} />
      </div>

      <div className="flex gap-2.5">
        <SkeletonOutcomeCell />
        <SkeletonOutcomeCell />
      </div>

      {/* The graduation bar's real track — chrome, so it is drawn rather than
          guessed — with the unknown fill shimmering inside it. */}
      <div
        className="overflow-hidden rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-raised)]"
        // The real bar sets `height` on the bordered track itself, and the app
        // is border-box, so the border sits inside the 8px. Matching the shape
        // means matching that, not adding 8px of fill inside a border.
        style={{ height: 8 }}
      >
        <Skeleton className="h-full" radius="pill" width="100%" />
      </div>

      <div className="mt-auto flex justify-between border-t border-[var(--border-soft)] pt-3">
        <SkeletonTypeLine className={FOOTER_CLASS} width={92} />
        <SkeletonTypeLine className={FOOTER_CLASS} width={68} />
      </div>
    </div>
  );
}

/**
 * Type classes lifted from the real components, so the placeholders inherit
 * their line boxes rather than guessing at pixel heights. They are copied
 * rather than imported because the real components spell them inline at the
 * call site.
 *
 * A copy is a thing that drifts, so `skeleton-shape.guardrail.test.tsx` asserts
 * every string here is still carried by an element in the component it was
 * taken from. Extracting them into shared constants on those components would
 * remove the copy outright — worth doing when the adoption PR touches them.
 */
const PILL_CLASS =
  "rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] tracking-[0.12em]";
const FOOTER_CLASS = "font-mono text-[11px]";
const OUTCOME_LABEL_CLASS = "font-mono text-xs font-bold tracking-[0.06em]";
const OUTCOME_PRICE_CLASS = "font-display tabular text-[26px] font-black";

/**
 * Which real component each mirrored class string was taken from. Read by the
 * shape guardrail; not part of the rendering API.
 */
export const SKELETON_MIRRORED_TYPE_CLASSES: Record<string, string[]> = {
  "market-card.tsx": [PILL_CLASS, FOOTER_CLASS],
  "metric-card.tsx": [METRIC_LABEL_CLASS, METRIC_VALUE_CLASS],
  "outcome-button.tsx": [OUTCOME_LABEL_CLASS, OUTCOME_PRICE_CLASS],
};

/** The YES/NO price cell inside a market card, at its real padded height. */
function SkeletonOutcomeCell() {
  return (
    <div className="flex flex-1 flex-col items-start gap-1 rounded-[var(--radius-md)] border border-[var(--border)] p-3.5">
      <SkeletonTypeLine className={OUTCOME_LABEL_CLASS} width={38} />
      <SkeletonTypeLine className={OUTCOME_PRICE_CLASS} width={72} />
    </div>
  );
}

/**
 * Table body rows for the portfolio's section tables. `columns` takes the same
 * grid template the real table uses, so the placeholder columns line up with
 * the header that is already on screen — a skeleton table whose columns move
 * when the data lands looks broken twice.
 */
export function SkeletonTableRows({
  columns,
  rows = 3,
}: {
  /** A CSS grid template, e.g. the table's `1.4fr 0.4fr 0.5fr 0.9fr`. */
  columns: string;
  rows?: number;
}) {
  const columnCount = columns.trim().split(/\s+/).length;

  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_unused, rowIndex) => (
        <div
          className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 last:border-b-0"
          key={rowIndex}
          style={{ gridTemplateColumns: columns }}
        >
          {Array.from({ length: columnCount }, (_unusedCell, columnIndex) => (
            <Skeleton
              height={14}
              key={columnIndex}
              radius="pill"
              // The first column carries the market name and reads longest;
              // the rest are mono figures and stop well short of their cell.
              width={columnIndex === 0 ? "80%" : "58%"}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Stands in for the price curve: legend, the 170px plot box with its real
 * gridlines drawn, the x-tick strip, and the range control. The gridlines are
 * chrome the chart always draws at the same positions, so they are rendered
 * for real — only the plotted series is unknown, and only it shimmers.
 */
export function SkeletonChart() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Skeleton height={14} radius="pill" width={96} />
        <Skeleton height={14} radius="pill" width={88} />
      </div>

      <div className="relative h-[170px] w-full">
        {[25, 50, 75].map((level) => (
          <div
            className="absolute inset-x-0 border-t border-dotted border-[var(--border-soft)] opacity-60"
            key={level}
            style={{ top: `${level}%` }}
          />
        ))}
        <Skeleton className="absolute inset-x-0 bottom-0" height="58%" radius="sm" />
      </div>

      <div className="mt-1 flex h-4 justify-between">
        {[0, 1, 2, 3].map((tick) => (
          <Skeleton height={9} key={tick} radius="pill" width={34} />
        ))}
      </div>

      <div className="mt-3">
        <Skeleton height={30} radius="md" width={220} />
      </div>
    </div>
  );
}

/**
 * The accessible wrapper a set of skeletons belongs in. Announces the wait
 * once — a screen-reader user needs to hear "loading positions", not the
 * eleven placeholder shapes that convey it visually — and marks the region
 * busy so assistive tech does not read the half-built layout as content.
 *
 * `label` names what is loading, in the same voice as the surface it replaces.
 */
export function SkeletonRegion({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div aria-busy="true" className={className} role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
