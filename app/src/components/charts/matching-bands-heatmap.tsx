"use client";

import { useMemo, useState } from "react";

import { overlapPriceBand } from "@/domain/graduation/clearing";
import type { MarketSide } from "@/domain/markets/types";
import type { PriceBand } from "@/domain/receipts/types";
import { formatCents, formatPercent, formatUsdCompact } from "@/lib/format";

import type { MatchingBandMatch, MatchingBandReceipt } from "./matching-bands-graphic";

const BUCKETS = Array.from({ length: 10 }, (_, index) => ({
  fromProbability: index * 10,
  toProbability: (index + 1) * 10,
}));
const AXIS_TICKS = [0, 25, 50, 75, 100] as const;

type HeatmapCell = {
  band: PriceBand;
  counterpartLabels: string[];
  coveragePercent: number;
  id: string;
  matched: boolean;
  receipt: MatchingBandReceipt;
  rowIndex: number;
};

export type MatchingBandsHeatmapProps = {
  className?: string;
  matches: MatchingBandMatch[];
  receipts: MatchingBandReceipt[];
};

export function MatchingBandsHeatmap({
  className,
  matches,
  receipts,
}: MatchingBandsHeatmapProps) {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const orderedReceipts = useMemo(
    () => [...receipts].sort((a, b) => a.placedAtMs - b.placedAtMs),
    [receipts]
  );
  const cells = useMemo(
    () => buildHeatmapCells({ matches, receipts: orderedReceipts }),
    [matches, orderedReceipts]
  );
  const activeCell = cells.find((cell) => cell.id === activeCellId) ?? null;

  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-tile)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="matching-bands-heatmap"
    >
      <div className="grid grid-cols-[minmax(6rem,8.75rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="h-7" />
        <div className="relative h-7 border-b border-[var(--border-soft)]">
          {AXIS_TICKS.map((tick) => (
            <span
              className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-[var(--text-muted)]"
              key={tick}
              style={{ left: `${tick}%` }}
            >
              {formatCents(tick)}
            </span>
          ))}
        </div>

        <div className="grid gap-1.5">
          {orderedReceipts.map((receipt) => (
            <ReceiptAxisLabel key={receipt.id} receipt={receipt} />
          ))}
        </div>

        <div className="relative">
          <div className="grid gap-1.5">
            {orderedReceipts.map((receipt) => (
              <div
                className="grid h-11 grid-cols-10 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-soft)] bg-[var(--surface-raised)]"
                key={receipt.id}
              >
                {cells
                  .filter((cell) => cell.receipt.id === receipt.id)
                  .map((cell) => (
                    <HeatmapCellButton
                      active={cell.id === activeCellId}
                      cell={cell}
                      key={cell.id}
                      onActivate={() => setActiveCellId(cell.id)}
                      onDeactivate={() => setActiveCellId(null)}
                    />
                  ))}
              </div>
            ))}
          </div>

          {activeCell ? <HeatmapTooltip cell={activeCell} /> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <LegendChip color="var(--yes-wash)" label="YES coverage" />
        <LegendChip color="var(--no-wash)" label="NO coverage" />
        <LegendChip color="var(--status-graduated)" label="Cleared overlap" />
        <LegendChip color="var(--surface-raised)" label="No receipt path" />
      </div>
    </div>
  );
}

function ReceiptAxisLabel({ receipt }: { receipt: MatchingBandReceipt }) {
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 border-b border-[var(--border-soft)] last:border-b-0">
      <span
        className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
        style={{
          borderColor: sideColor(receipt.side, "border"),
          color: sideColor(receipt.side, "solid"),
        }}
      >
        {sideLabel(receipt.side)}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-[var(--text-muted)]">
          {receipt.placedAtLabel}
        </div>
        <div className="truncate text-xs font-bold text-[var(--text-primary)]">
          {receipt.label}
        </div>
      </div>
    </div>
  );
}

function HeatmapCellButton({
  active,
  cell,
  onActivate,
  onDeactivate,
}: {
  active: boolean;
  cell: HeatmapCell;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const covered = cell.coveragePercent > 0;
  const background = covered ? sideColor(cell.receipt.side, "wash") : "transparent";
  const glow = cell.matched
    ? `inset 0 0 ${Math.max(14, 30 * cell.coveragePercent)}px rgb(198 255 61 / 42%), 0 0 18px rgb(31 224 255 / 24%)`
    : "none";

  return (
    <button
      aria-label={`${cell.receipt.label} ${formatPriceBand(cell.band)} ${cell.matched ? "matched" : covered ? "receipt path" : "empty"}`}
      className="focus-ring relative min-w-0 border-r border-[var(--border-soft)] last:border-r-0"
      data-testid={`heatmap-cell-${cell.receipt.id}-${cell.band.fromProbability}`}
      onBlur={onDeactivate}
      onFocus={onActivate}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      style={{
        background,
        boxShadow: active ? "inset 0 0 0 1px var(--pc-cyan), var(--glow-cyan)" : glow,
        opacity: covered ? 0.72 + cell.coveragePercent * 0.28 : 0.42,
      }}
      type="button"
    >
      {cell.matched ? (
        <span
          aria-hidden
          className="absolute inset-1 rounded-[var(--radius-sm)]"
          style={{
            background:
              "linear-gradient(135deg, var(--status-graduated), var(--pc-cyan))",
            opacity: Math.max(0.36, cell.coveragePercent),
          }}
        />
      ) : null}
      <span className="sr-only">{formatPriceBand(cell.band)}</span>
    </button>
  );
}

function HeatmapTooltip({ cell }: { cell: HeatmapCell }) {
  const left = `${cell.band.fromProbability + 5}%`;
  const nearRight = cell.band.fromProbability >= 70;

  return (
    <div
      className="pointer-events-none absolute z-30 w-[min(18rem,calc(100%-1rem))] rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-tile)]"
      data-testid="heatmap-tooltip"
      role="tooltip"
      style={{
        left,
        top: Math.max(0, cell.rowIndex * 50 - 4),
        transform: nearRight ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-black text-[var(--text-primary)]">
          {cell.receipt.label}
        </span>
        <span
          className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
          style={{
            borderColor: sideColor(cell.receipt.side, "border"),
            color: sideColor(cell.receipt.side, "solid"),
          }}
        >
          {sideLabel(cell.receipt.side)}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <dt className="text-[var(--text-muted)]">Band</dt>
        <dd className="text-right text-[var(--text-secondary)]">
          {formatPriceBand(cell.band)}
        </dd>
        <dt className="text-[var(--text-muted)]">Status</dt>
        <dd
          className="text-right font-bold"
          style={{
            color: cell.matched ? "var(--status-graduated)" : "var(--text-secondary)",
          }}
        >
          {cell.matched
            ? "Cleared overlap"
            : cell.coveragePercent > 0
              ? "Receipt path"
              : "No path"}
        </dd>
        <dt className="text-[var(--text-muted)]">Coverage</dt>
        <dd className="text-right text-[var(--text-secondary)]">
          {formatPercent(cell.coveragePercent * 100)}
        </dd>
        <dt className="text-[var(--text-muted)]">With</dt>
        <dd className="truncate text-right text-[var(--text-secondary)]">
          {cell.counterpartLabels.length > 0
            ? cell.counterpartLabels.join(", ")
            : "No cleared overlap"}
        </dd>
        {cell.receipt.amountUsd === undefined ? null : (
          <>
            <dt className="text-[var(--text-muted)]">Receipt</dt>
            <dd className="text-right text-[var(--text-secondary)]">
              {formatUsdCompact(cell.receipt.amountUsd)}
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

function buildHeatmapCells({
  matches,
  receipts,
}: {
  matches: MatchingBandMatch[];
  receipts: MatchingBandReceipt[];
}) {
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  return receipts.flatMap((receipt, rowIndex) =>
    BUCKETS.map((band) => {
      const receiptOverlap = overlapPriceBand(receipt.priceBand, band);
      const matching = matches.filter(
        (match) =>
          match.receiptIds.includes(receipt.id) &&
          overlapPriceBand(match.priceBand, band) !== null
      );
      const counterpartLabels = Array.from(
        new Set(
          matching
            .flatMap((match) => match.receiptIds)
            .filter((receiptId) => receiptId !== receipt.id)
            .map((receiptId) => receiptById.get(receiptId)?.label ?? receiptId)
        )
      );

      return {
        band,
        counterpartLabels,
        coveragePercent: receiptOverlap
          ? bandLength(normalizeBand(receiptOverlap)) / bandLength(band)
          : 0,
        id: `${receipt.id}-${band.fromProbability}`,
        matched: matching.length > 0,
        receipt,
        rowIndex,
      };
    })
  );
}

function formatPriceBand(band: PriceBand) {
  const normalized = normalizeBand(band);

  return `${formatCents(normalized.fromProbability)}-${formatCents(
    normalized.toProbability
  )}`;
}

function normalizeBand(band: PriceBand) {
  return {
    fromProbability: Math.min(band.fromProbability, band.toProbability),
    toProbability: Math.max(band.fromProbability, band.toProbability),
  };
}

function bandLength(band: PriceBand) {
  const normalized = normalizeBand(band);

  return normalized.toProbability - normalized.fromProbability;
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
