"use client";

import { useMemo, useState } from "react";

import { overlapPriceBand } from "@/domain/graduation/clearing";
import type { MarketSide } from "@/domain/markets/types";
import type { PriceBand } from "@/domain/receipts/types";
import { formatCents, formatPercent, formatUsdCompact } from "@/lib/format";

import type { MatchingBandMatch, MatchingBandReceipt } from "./matching-bands-graphic";

type AnatomySegment = {
  band: PriceBand;
  counterpartLabels: string[];
  id: string;
  matched: boolean;
  percentOfReceipt: number;
};

type AnatomyView = {
  averageMatchedPrice: number | null;
  matchedPercent: number;
  receipt: MatchingBandReceipt;
  refundedPercent: number;
  segments: AnatomySegment[];
};

export type ReceiptAnatomyViewProps = {
  className?: string;
  initialReceiptId?: string;
  matches: MatchingBandMatch[];
  receipts: MatchingBandReceipt[];
};

export function ReceiptAnatomyView({
  className,
  initialReceiptId,
  matches,
  receipts,
}: ReceiptAnatomyViewProps) {
  const orderedReceipts = useMemo(
    () => [...receipts].sort((a, b) => a.placedAtMs - b.placedAtMs),
    [receipts]
  );
  const [activeReceiptId, setActiveReceiptId] = useState(
    initialReceiptId ?? orderedReceipts[0]?.id ?? ""
  );
  const activeReceipt =
    orderedReceipts.find((receipt) => receipt.id === activeReceiptId) ??
    orderedReceipts[0] ??
    null;
  const view = useMemo(
    () =>
      activeReceipt
        ? buildAnatomyView({
            matches,
            receipt: activeReceipt,
            receipts: orderedReceipts,
          })
        : null,
    [activeReceipt, matches, orderedReceipts]
  );
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const activeSegment =
    activeSegmentId && view
      ? (view.segments.find((segment) => segment.id === activeSegmentId) ?? null)
      : (view?.segments.find((segment) => segment.matched) ??
        view?.segments[0] ??
        null);

  if (!view) {
    return null;
  }

  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-tile)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="receipt-anatomy-view"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {orderedReceipts.map((receipt) => (
          <button
            className="focus-ring rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors"
            data-testid={`receipt-selector-${receipt.id}`}
            key={receipt.id}
            onClick={() => {
              setActiveReceiptId(receipt.id);
              setActiveSegmentId(null);
            }}
            style={{
              background:
                receipt.id === view.receipt.id
                  ? sideColor(receipt.side, "wash")
                  : "var(--surface-raised)",
              borderColor:
                receipt.id === view.receipt.id
                  ? sideColor(receipt.side, "border")
                  : "var(--border)",
            }}
            type="button"
          >
            <span
              className="mr-2 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
              style={{
                borderColor: sideColor(receipt.side, "border"),
                color: sideColor(receipt.side, "solid"),
              }}
            >
              {sideLabel(receipt.side)}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-secondary)]">
              {receipt.label}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.62fr_1.38fr]">
        <aside className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <Metric
            label="Matched"
            testId="anatomy-summary-matched"
            value={formatPercent(view.matchedPercent)}
          />
          <Metric label="Refunded" value={formatPercent(view.refundedPercent)} />
          <Metric
            label="Avg matched price"
            value={
              view.averageMatchedPrice === null
                ? "unmatched"
                : formatCents(view.averageMatchedPrice)
            }
          />
        </aside>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  style={{
                    borderColor: sideColor(view.receipt.side, "border"),
                    color: sideColor(view.receipt.side, "solid"),
                  }}
                >
                  {sideLabel(view.receipt.side)}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {view.receipt.placedAtLabel}
                </span>
              </div>
              <div className="truncate text-sm font-black text-[var(--text-primary)]">
                {view.receipt.label}
              </div>
            </div>
            {view.receipt.amountUsd === undefined ? null : (
              <span className="font-display text-lg font-black text-[var(--text-primary)]">
                {formatUsdCompact(view.receipt.amountUsd)}
              </span>
            )}
          </div>

          <div
            className="relative mb-3 flex h-16 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)]"
            data-testid="anatomy-strip"
          >
            {view.segments.map((segment) => (
              <button
                aria-label={`${formatPriceBand(segment.band)} ${segment.matched ? "matched" : "refunded"}`}
                className="focus-ring relative min-w-3 overflow-hidden border-r border-[var(--border-soft)] text-left last:border-r-0"
                data-testid={`anatomy-segment-${segment.id}`}
                key={segment.id}
                onBlur={() => setActiveSegmentId(null)}
                onFocus={() => setActiveSegmentId(segment.id)}
                onMouseEnter={() => setActiveSegmentId(segment.id)}
                onMouseLeave={() => setActiveSegmentId(null)}
                style={{
                  background: segment.matched
                    ? "linear-gradient(135deg, var(--status-graduated), var(--pc-cyan))"
                    : sideColor(view.receipt.side, "wash"),
                  boxShadow:
                    activeSegment?.id === segment.id
                      ? "inset 0 0 0 2px var(--pc-paper), var(--glow-cyan)"
                      : segment.matched
                        ? "inset 0 0 18px rgb(198 255 61 / 28%)"
                        : "none",
                  opacity: segment.matched ? 1 : 0.52,
                  width: `${segment.percentOfReceipt}%`,
                }}
                type="button"
              >
                <span className="absolute inset-x-1 bottom-1 truncate font-mono text-[9px] font-bold text-[var(--pc-ink)]">
                  {segment.matched ? "MATCH" : "REFUND"}
                </span>
              </button>
            ))}
          </div>

          {activeSegment ? (
            <SegmentDetail receipt={view.receipt} segment={activeSegment} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  testId,
  value,
}: {
  label: string;
  testId?: string;
  value: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
      <div className="mb-1 font-mono text-[10px] text-[var(--text-muted)]">{label}</div>
      <div
        className="font-display text-lg font-black text-[var(--text-primary)]"
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}

function SegmentDetail({
  receipt,
  segment,
}: {
  receipt: MatchingBandReceipt;
  segment: AnatomySegment;
}) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] p-3"
      data-testid="anatomy-active-detail"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span
          className="font-display text-sm font-black"
          style={{
            color: segment.matched
              ? "var(--status-graduated)"
              : sideColor(receipt.side, "solid"),
          }}
        >
          {segment.matched ? "Matched segment" : "Refunded segment"}
        </span>
        <span className="font-mono text-[10px] text-[var(--text-secondary)]">
          {formatPriceBand(segment.band)}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <dt className="text-[var(--text-muted)]">Receipt share</dt>
        <dd className="text-right text-[var(--text-secondary)]">
          {formatPercent(segment.percentOfReceipt)}
        </dd>
        <dt className="text-[var(--text-muted)]">Counterparts</dt>
        <dd className="truncate text-right text-[var(--text-secondary)]">
          {segment.counterpartLabels.length > 0
            ? segment.counterpartLabels.join(", ")
            : "No counterpart"}
        </dd>
      </dl>
      {segment.counterpartLabels.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {segment.counterpartLabels.map((label) => (
            <span
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]"
              key={label}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildAnatomyView({
  matches,
  receipt,
  receipts,
}: {
  matches: MatchingBandMatch[];
  receipt: MatchingBandReceipt;
  receipts: MatchingBandReceipt[];
}): AnatomyView {
  const receiptBand = normalizeBand(receipt.priceBand);
  const receiptLength = bandLength(receiptBand);
  const receiptById = new Map(receipts.map((entry) => [entry.id, entry]));
  const matchedIntervals = matches.flatMap((match) => {
    if (!match.receiptIds.includes(receipt.id)) {
      return [];
    }

    const overlap = overlapPriceBand(receiptBand, match.priceBand);

    if (!overlap) {
      return [];
    }

    const counterpartLabels = match.receiptIds.flatMap((receiptId) => {
      if (receiptId === receipt.id) {
        return [];
      }

      const counterpart = receiptById.get(receiptId);

      if (!counterpart || !overlapPriceBand(counterpart.priceBand, match.priceBand)) {
        return [];
      }

      return [counterpart.label];
    });

    if (counterpartLabels.length === 0) {
      return [];
    }

    return [
      {
        band: normalizeBand(overlap),
        counterpartLabels,
      },
    ];
  });
  const breakpoints = Array.from(
    new Set([
      receiptBand.fromProbability,
      receiptBand.toProbability,
      ...matchedIntervals.flatMap((interval) => [
        interval.band.fromProbability,
        interval.band.toProbability,
      ]),
    ])
  ).sort((a, b) => a - b);
  const segments = breakpoints.slice(0, -1).flatMap((fromProbability, index) => {
    const toProbability = breakpoints[index + 1]!;

    const band = { fromProbability, toProbability };
    const labels = Array.from(
      new Set(
        matchedIntervals
          .filter((interval) => overlapPriceBand(interval.band, band) !== null)
          .flatMap((interval) => interval.counterpartLabels)
      )
    );

    return [
      {
        band,
        counterpartLabels: labels,
        id: `${labels.length > 0 ? "matched" : "refunded"}-${fromProbability}-${toProbability}`,
        matched: labels.length > 0,
        /* v8 ignore next -- zero-length receipts produce no segments. */
        percentOfReceipt:
          receiptLength === 0 ? 0 : (bandLength(band) / receiptLength) * 100,
      },
    ];
  });
  const matchedWidth = segments
    .filter((segment) => segment.matched)
    .reduce((total, segment) => total + bandLength(segment.band), 0);
  const matchedPercent = receiptLength === 0 ? 0 : (matchedWidth / receiptLength) * 100;
  const averageMatchedPrice =
    matchedWidth === 0
      ? null
      : segments
          .filter((segment) => segment.matched)
          .reduce(
            (total, segment) =>
              total + bandMidpoint(segment.band) * bandLength(segment.band),
            0
          ) / matchedWidth;

  return {
    averageMatchedPrice,
    matchedPercent,
    receipt,
    refundedPercent: 100 - matchedPercent,
    segments,
  };
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

function bandMidpoint(band: PriceBand) {
  const normalized = normalizeBand(band);

  return (normalized.fromProbability + normalized.toProbability) / 2;
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
