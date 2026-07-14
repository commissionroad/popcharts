"use client";

import { Loader2, TriangleAlert, X } from "lucide-react";

import type { Market } from "@/domain/markets/types";
import { formatCentsTenths } from "@/lib/format";

import { formatLimitOrderStep, formatVenueTokens } from "./postgrad-ticket-format";
import {
  type OpenOrderRow,
  useOpenOrdersPanelState,
} from "./use-open-orders-panel-state";

/**
 * Aside panel listing the connected wallet's resting limit orders on this
 * market, polled from the indexer, with a per-row cancel action. Hidden until
 * the wallet is connected on a live venue; when there are no orders it stays
 * hidden too unless the ticket is in limit mode, where it shows an empty
 * hint instead.
 */
export function OpenOrdersPanel({
  market,
  orderType,
  refreshKey,
}: {
  market: Market;
  orderType: "limit" | "market";
  refreshKey: number;
}) {
  const {
    cancelError,
    cancelStep,
    error,
    loading,
    ordersLoaded,
    rows,
    visible,
    cancelOrder,
  } = useOpenOrdersPanelState(market, { refreshKey });

  if (!visible || (rows.length === 0 && orderType !== "limit")) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        Your open orders
      </div>

      {error ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
          {loading || !ordersLoaded
            ? "Loading your open orders..."
            : "No open orders yet. Limit orders you place rest here until they fill or you cancel them."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <OpenOrderRowItem
              key={row.key}
              onCancel={() => void cancelOrder(row)}
              row={row}
            />
          ))}
        </ul>
      )}

      {cancelStep ? (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatLimitOrderStep(cancelStep)}
        </div>
      ) : null}

      {cancelError ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{cancelError}</span>
        </div>
      ) : null}
    </section>
  );
}

function OpenOrderRowItem({
  onCancel,
  row,
}: {
  onCancel: () => void;
  row: OpenOrderRow;
}) {
  const directionLabel = row.order.direction === "bid" ? "Buy" : "Sell";
  const directionColor = row.order.direction === "bid" ? "var(--yes)" : "var(--no)";

  return (
    <li className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-mono font-bold" style={{ color: directionColor }}>
            {directionLabel}
          </span>
          <span className="truncate font-mono text-[var(--text-primary)]">
            {row.sideLabel}
          </span>
          <span className="font-mono text-[var(--text-secondary)]">
            @ {formatCentsTenths(row.priceCents)}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
          <span>
            {formatVenueTokens(row.remainingSize)} / {formatVenueTokens(row.size)} tok
            open
          </span>
          {row.filling ? (
            <span className="inline-flex items-center gap-1 text-[var(--status-graduating)]">
              <Loader2 className="animate-spin" size={11} />
              Filling...
            </span>
          ) : null}
        </div>
      </div>
      <button
        aria-label={`Cancel ${directionLabel.toLowerCase()} order at ${formatCentsTenths(row.priceCents)}`}
        className="focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-2.5 font-mono text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--no)] hover:text-[var(--no)] disabled:pointer-events-none disabled:opacity-50"
        disabled={row.cancelling}
        onClick={onCancel}
        type="button"
      >
        {row.cancelling ? (
          <Loader2 className="animate-spin" size={12} />
        ) : (
          <X size={12} />
        )}
        Cancel
      </button>
    </li>
  );
}
