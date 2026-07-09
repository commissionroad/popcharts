"use client";

import { useMemo, useState } from "react";

import { overlapPriceBand } from "@/domain/graduation/clearing";
import type { MarketSide } from "@/domain/markets/types";
import type { PriceBand } from "@/domain/receipts/types";
import { formatCents, formatPercent, formatUsdCompact } from "@/lib/format";

const AXIS_HEIGHT = 24;
const ROW_HEIGHT = 58;
const BAND_HEIGHT = 26;
const TOOLTIP_HEIGHT = 118;
const TICKS = [0, 25, 50, 75, 100] as const;

export type MatchingBandReceipt = {
  amountUsd?: number;
  id: string;
  label: string;
  placedAtLabel: string;
  placedAtMs: number;
  priceBand: PriceBand;
  side: MarketSide;
};

export type MatchingBandMatch = {
  id: string;
  priceBand: PriceBand;
  receiptIds: string[];
};

export type MatchingBandsGraphicProps = {
  className?: string;
  matches: MatchingBandMatch[];
  receipts: MatchingBandReceipt[];
};

type NormalizedBand = {
  fromProbability: number;
  toProbability: number;
};

type ReceiptView = {
  averageMatchedPrice: number | null;
  counterpartLabels: string[];
  matchedBands: NormalizedBand[];
  matchedPercent: number;
  receipt: MatchingBandReceipt;
  rowIndex: number;
};

type MatchLink = {
  id: string;
  path: string;
};

export function MatchingBandsGraphic({
  className,
  matches,
  receipts,
}: MatchingBandsGraphicProps) {
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);
  const orderedReceipts = useMemo(
    () => [...receipts].sort((a, b) => a.placedAtMs - b.placedAtMs),
    [receipts]
  );
  const receiptById = useMemo(
    () => new Map(orderedReceipts.map((receipt) => [receipt.id, receipt])),
    [orderedReceipts]
  );
  const rows = useMemo(
    () =>
      orderedReceipts.map((receipt, rowIndex) =>
        buildReceiptView({
          matches,
          receipt,
          receiptById,
          rowIndex,
        })
      ),
    [matches, orderedReceipts, receiptById]
  );
  const activeRow =
    activeReceiptId === null
      ? null
      : (rows.find((row) => row.receipt.id === activeReceiptId) ?? null);
  const rowPlotHeight = rows.length * ROW_HEIGHT;
  const activeLinks = activeRow
    ? buildActiveLinks({ activeReceipt: activeRow.receipt, matches, orderedReceipts })
    : [];

  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-tile)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="matching-bands-graphic"
    >
      <div className="grid grid-cols-[minmax(5.8rem,8.25rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div style={{ height: AXIS_HEIGHT }} />
        <div
          className="relative border-b border-[var(--border-soft)]"
          style={{ height: AXIS_HEIGHT }}
        >
          {TICKS.map((tick) => (
            <span
              className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-[var(--text-muted)]"
              key={tick}
              style={{ left: `${tick}%` }}
            >
              {formatCents(tick)}
            </span>
          ))}
        </div>

        <div className="relative" style={{ height: rowPlotHeight }}>
          {rows.map(({ receipt, rowIndex }) => (
            <div
              className="absolute inset-x-0 flex items-center border-b border-[var(--border-soft)] py-2 last:border-b-0"
              key={receipt.id}
              style={{ height: ROW_HEIGHT, top: rowIndex * ROW_HEIGHT }}
            >
              <div className="min-w-0">
                <div className="mb-1 flex min-w-0 items-center gap-2">
                  <span
                    className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
                    style={{
                      borderColor: sideColor(receipt.side, "border"),
                      color: sideColor(receipt.side, "solid"),
                    }}
                  >
                    {sideLabel(receipt.side)}
                  </span>
                  <span className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
                    {receipt.placedAtLabel}
                  </span>
                </div>
                <div className="truncate text-xs font-bold text-[var(--text-primary)]">
                  {receipt.label}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="relative overflow-hidden" style={{ height: rowPlotHeight }}>
          {TICKS.map((tick) => (
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-dotted border-[var(--border-soft)]"
              key={tick}
              style={{ left: `${tick}%` }}
            />
          ))}
          {rows.map(({ receipt, rowIndex }) => (
            <div
              className="pointer-events-none absolute inset-x-0 border-b border-[var(--border-soft)] last:border-b-0"
              key={receipt.id}
              style={{ height: ROW_HEIGHT, top: rowIndex * ROW_HEIGHT }}
            />
          ))}

          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 size-full"
            preserveAspectRatio="none"
            viewBox={`0 0 100 ${rowPlotHeight}`}
          >
            {activeLinks.map((link) => (
              <path
                d={link.path}
                data-testid="matching-band-link"
                fill="none"
                key={link.id}
                stroke="var(--pc-cyan)"
                strokeLinecap="round"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {rows.map((row) => (
            <ReceiptBandButton
              active={row.receipt.id === activeReceiptId}
              key={row.receipt.id}
              onActivate={() => setActiveReceiptId(row.receipt.id)}
              onDeactivate={() => setActiveReceiptId(null)}
              row={row}
            />
          ))}

          {activeRow ? (
            <ReceiptTooltip row={activeRow} rowPlotHeight={rowPlotHeight} />
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <LegendChip color="var(--status-graduated)" label="Matched segment" />
        <LegendChip color="var(--yes-wash)" label="YES receipt path" />
        <LegendChip color="var(--no-wash)" label="NO receipt path" />
        <LegendChip color="var(--pc-cyan)" label="Active match link" />
      </div>
    </div>
  );
}

function ReceiptBandButton({
  active,
  onActivate,
  onDeactivate,
  row,
}: {
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  row: ReceiptView;
}) {
  const { receipt, rowIndex } = row;
  const receiptBand = normalizeBand(receipt.priceBand);
  const bandWidth = bandLength(receiptBand);
  const top = rowIndex * ROW_HEIGHT + (ROW_HEIGHT - BAND_HEIGHT) / 2;

  return (
    <button
      aria-label={`${receipt.label}: ${formatPercent(row.matchedPercent)} matched at ${matchedPriceLabel(row)}`}
      className="focus-ring absolute z-20 overflow-hidden rounded-[var(--radius-sm)] border text-left transition-[box-shadow,opacity,transform] hover:-translate-y-0.5"
      data-testid={`matching-band-${receipt.id}`}
      onBlur={onDeactivate}
      onFocus={onActivate}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      style={{
        background: sideColor(receipt.side, "wash"),
        borderColor: active
          ? "var(--status-graduated)"
          : sideColor(receipt.side, "border"),
        boxShadow: active
          ? "0 0 0 1px var(--status-graduated), var(--glow-lime)"
          : "none",
        height: BAND_HEIGHT,
        left: `${receiptBand.fromProbability}%`,
        top,
        width: `${bandWidth}%`,
      }}
      type="button"
    >
      <span className="sr-only">{receipt.label}</span>
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-1 rounded-[var(--radius-pill)]"
        style={{ background: sideColor(receipt.side, "solid") }}
      />
      {row.matchedBands.map((matchedBand) => {
        const matchedLeft =
          ((matchedBand.fromProbability - receiptBand.fromProbability) / bandWidth) *
          100;
        const matchedWidth = (bandLength(matchedBand) / bandWidth) * 100;

        return (
          <span
            aria-hidden
            className="absolute inset-y-1 rounded-[var(--radius-sm)]"
            data-testid={`matched-segment-${receipt.id}`}
            key={`${receipt.id}-${matchedBand.fromProbability}-${matchedBand.toProbability}`}
            style={{
              background:
                "linear-gradient(90deg, var(--status-graduated), var(--pc-cyan))",
              boxShadow: "0 0 18px rgb(198 255 61 / 28%)",
              left: `${matchedLeft}%`,
              width: `${matchedWidth}%`,
            }}
          />
        );
      })}
    </button>
  );
}

function ReceiptTooltip({
  row,
  rowPlotHeight,
}: {
  row: ReceiptView;
  rowPlotHeight: number;
}) {
  const receiptBand = normalizeBand(row.receipt.priceBand);
  const midpoint = bandMidpoint(receiptBand);
  const nearRight = midpoint > 64;
  const top = Math.min(
    Math.max(0, row.rowIndex * ROW_HEIGHT + 2),
    Math.max(0, rowPlotHeight - TOOLTIP_HEIGHT)
  );

  return (
    <div
      className="pointer-events-none absolute z-30 w-[min(18rem,calc(100%-1rem))] rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-tile)]"
      data-testid="matching-band-tooltip"
      role="tooltip"
      style={{
        left: `${midpoint}%`,
        top,
        transform: nearRight ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-black text-[var(--text-primary)]">
          {row.receipt.label}
        </span>
        <span
          className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
          style={{
            borderColor: sideColor(row.receipt.side, "border"),
            color: sideColor(row.receipt.side, "solid"),
          }}
        >
          {sideLabel(row.receipt.side)}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <dt className="text-[var(--text-muted)]">Matched</dt>
        <dd className="text-right font-bold text-[var(--status-graduated)]">
          {formatPercent(row.matchedPercent)}
        </dd>
        <dt className="text-[var(--text-muted)]">Price</dt>
        <dd className="text-right text-[var(--text-secondary)]">
          {matchedPriceLabel(row)}
        </dd>
        <dt className="text-[var(--text-muted)]">With</dt>
        <dd className="truncate text-right text-[var(--text-secondary)]">
          {row.counterpartLabels.length > 0
            ? row.counterpartLabels.join(", ")
            : "No matched band"}
        </dd>
        {row.receipt.amountUsd === undefined ? null : (
          <>
            <dt className="text-[var(--text-muted)]">Receipt</dt>
            <dd className="text-right text-[var(--text-secondary)]">
              {formatUsdCompact(row.receipt.amountUsd)}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
      <span
        aria-hidden
        className="size-2.5 rounded-[var(--radius-sm)] border border-[var(--border)]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function buildReceiptView({
  matches,
  receipt,
  receiptById,
  rowIndex,
}: {
  matches: MatchingBandMatch[];
  receipt: MatchingBandReceipt;
  receiptById: Map<string, MatchingBandReceipt>;
  rowIndex: number;
}): ReceiptView {
  const receiptBand = normalizeBand(receipt.priceBand);
  const matchedBands = mergeBands(
    matches.flatMap((match) => {
      if (!match.receiptIds.includes(receipt.id)) {
        return [];
      }

      const overlap = overlapPriceBand(receiptBand, match.priceBand);

      return overlap ? [normalizeBand(overlap)] : [];
    })
  );
  const matchedLength = matchedBands.reduce(
    (total, band) => total + bandLength(band),
    0
  );
  const receiptLength = bandLength(receiptBand);
  const counterpartLabels = Array.from(
    new Set(
      matches
        .filter((match) => match.receiptIds.includes(receipt.id))
        .flatMap((match) => match.receiptIds)
        .filter((receiptId) => receiptId !== receipt.id)
        .map((receiptId) => receiptById.get(receiptId)?.label ?? receiptId)
    )
  );

  return {
    averageMatchedPrice: weightedAverageMidpoint(matchedBands),
    counterpartLabels,
    matchedBands,
    matchedPercent: receiptLength === 0 ? 0 : (matchedLength / receiptLength) * 100,
    receipt,
    rowIndex,
  };
}

function buildActiveLinks({
  activeReceipt,
  matches,
  orderedReceipts,
}: {
  activeReceipt: MatchingBandReceipt;
  matches: MatchingBandMatch[];
  orderedReceipts: MatchingBandReceipt[];
}): MatchLink[] {
  const receiptIndex = new Map(
    orderedReceipts.map((receipt, index) => [receipt.id, index])
  );
  const activeRowIndex = receiptIndex.get(activeReceipt.id);

  if (activeRowIndex === undefined) {
    return [];
  }

  return matches.flatMap((match, matchIndex) => {
    if (!match.receiptIds.includes(activeReceipt.id)) {
      return [];
    }

    const activeOverlap = overlapPriceBand(activeReceipt.priceBand, match.priceBand);

    if (!activeOverlap) {
      return [];
    }

    return match.receiptIds
      .filter((receiptId) => receiptId !== activeReceipt.id)
      .flatMap((receiptId, peerIndex) => {
        const peer = orderedReceipts.find((receipt) => receipt.id === receiptId);
        const peerRowIndex = receiptIndex.get(receiptId);

        if (!peer || peerRowIndex === undefined) {
          return [];
        }

        const peerOverlap = overlapPriceBand(peer.priceBand, match.priceBand);

        if (!peerOverlap) {
          return [];
        }

        const x1 = bandMidpoint(normalizeBand(activeOverlap));
        const x2 = bandMidpoint(normalizeBand(peerOverlap));
        const y1 = activeRowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const y2 = peerRowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
        const bend = (matchIndex + peerIndex) % 2 === 0 ? 10 : -10;
        const controlX = clamp((x1 + x2) / 2 + bend, 4, 96);

        return [
          {
            id: `${match.id}-${activeReceipt.id}-${receiptId}`,
            path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${controlX.toFixed(
              2
            )} ${(y1 + (y2 - y1) * 0.3).toFixed(2)}, ${controlX.toFixed(2)} ${(
              y1 +
              (y2 - y1) * 0.7
            ).toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`,
          },
        ];
      });
  });
}

function matchedPriceLabel(row: ReceiptView) {
  if (row.matchedBands.length === 0 || row.averageMatchedPrice === null) {
    return "unmatched";
  }

  const bands = row.matchedBands.map(formatPriceBand).join(", ");

  return `${bands} avg ${formatCents(row.averageMatchedPrice)}`;
}

function formatPriceBand(band: NormalizedBand) {
  return `${formatCents(band.fromProbability)}-${formatCents(band.toProbability)}`;
}

function mergeBands(bands: NormalizedBand[]) {
  const sorted = bands
    .map(normalizeBand)
    .sort((a, b) => a.fromProbability - b.fromProbability);
  const merged: NormalizedBand[] = [];

  for (const band of sorted) {
    const previous = merged.at(-1);

    if (!previous || band.fromProbability > previous.toProbability) {
      merged.push({ ...band });
      continue;
    }

    previous.toProbability = Math.max(previous.toProbability, band.toProbability);
  }

  return merged;
}

function normalizeBand(band: PriceBand): NormalizedBand {
  return {
    fromProbability: Math.min(band.fromProbability, band.toProbability),
    toProbability: Math.max(band.fromProbability, band.toProbability),
  };
}

function bandLength(band: NormalizedBand) {
  return band.toProbability - band.fromProbability;
}

function bandMidpoint(band: NormalizedBand) {
  return (band.fromProbability + band.toProbability) / 2;
}

function weightedAverageMidpoint(bands: NormalizedBand[]) {
  const totalWidth = bands.reduce((total, band) => total + bandLength(band), 0);

  if (totalWidth === 0) {
    return null;
  }

  const weightedTotal = bands.reduce(
    (total, band) => total + bandMidpoint(band) * bandLength(band),
    0
  );

  return weightedTotal / totalWidth;
}

function sideLabel(side: MarketSide) {
  return side === "yes" ? "YES" : "NO";
}

function sideColor(side: MarketSide, token: "border" | "solid" | "wash") {
  if (side === "yes") {
    return token === "solid"
      ? "var(--yes)"
      : token === "border"
        ? "var(--yes-border)"
        : "var(--yes-wash)";
  }

  return token === "solid"
    ? "var(--no)"
    : token === "border"
      ? "var(--no-border)"
      : "var(--no-wash)";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
