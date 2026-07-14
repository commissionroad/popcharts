import type { CSSProperties } from "react";

import { formatCentsTenths } from "@/lib/format";

import { formatLadderShares } from "./order-book-format";
import type { OrderBookLevelView, OrderBookPoolView } from "./order-book-model";

/**
 * The depth ladder for one outcome pool: asks above, the spread and pool
 * price between, bids below. Each row carries a background depth bar sized
 * by its cumulative share total, the standard prediction-market affordance
 * for judging book depth at a glance.
 */
export function OrderBookLadder({
  pool,
  sideLabel,
}: {
  pool: OrderBookPoolView;
  sideLabel: string;
}) {
  if (pool.asks.length === 0 && pool.bids.length === 0) {
    return (
      <p className="py-6 text-center font-mono text-xs text-[var(--text-muted)]">
        No resting orders yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-xs">
        <caption className="sr-only">{sideLabel} order book depth ladder</caption>
        <thead>
          <tr className="text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
            <th className="px-2 py-1.5 text-left font-normal" scope="col">
              Price
            </th>
            <th className="px-2 py-1.5 text-right font-normal" scope="col">
              Shares
            </th>
            <th className="px-2 py-1.5 text-right font-normal" scope="col">
              Total
            </th>
            <th className="px-2 py-1.5 text-right font-normal" scope="col">
              Orders
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Asks render worst-first so the best ask sits against the spread row. */}
          {pool.asks.length === 0 ? (
            <EmptyHalfRow label="No resting asks yet." />
          ) : (
            pool.asks
              .slice()
              .reverse()
              .map((level) => (
                <LadderRow
                  half="ask"
                  key={`ask-${level.priceCents}`}
                  level={level}
                  maxCumulativeShares={pool.maxCumulativeShares}
                />
              ))
          )}
          <SpreadRow pool={pool} />
          {pool.bids.length === 0 ? (
            <EmptyHalfRow label="No resting bids yet." />
          ) : (
            pool.bids.map((level) => (
              <LadderRow
                half="bid"
                key={`bid-${level.priceCents}`}
                level={level}
                maxCumulativeShares={pool.maxCumulativeShares}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LadderRow({
  half,
  level,
  maxCumulativeShares,
}: {
  half: "ask" | "bid";
  level: OrderBookLevelView;
  maxCumulativeShares: number;
}) {
  const depthRatio =
    maxCumulativeShares > 0 ? level.cumulativeShares / maxCumulativeShares : 0;
  const wash = half === "ask" ? "var(--no-wash)" : "var(--yes-wash)";
  const depthStyle: CSSProperties = {
    background: `linear-gradient(to left, ${wash} ${(depthRatio * 100).toFixed(
      1
    )}%, transparent 0)`,
  };

  return (
    <tr className="tabular" style={depthStyle}>
      <td
        className={`px-2 py-1.5 text-left font-bold ${
          half === "ask" ? "text-[var(--no)]" : "text-[var(--yes)]"
        }`}
      >
        {formatCentsTenths(level.priceCents)}
      </td>
      <td className="px-2 py-1.5 text-right text-[var(--text-primary)]">
        {formatLadderShares(level.sizeShares)}
      </td>
      <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
        {formatLadderShares(level.cumulativeShares)}
      </td>
      <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">
        {level.orderCount}
      </td>
    </tr>
  );
}

function SpreadRow({ pool }: { pool: OrderBookPoolView }) {
  const parts = [
    pool.spreadCents === null ? null : `Spread ${formatCentsTenths(pool.spreadCents)}`,
    pool.marketPriceCents === null
      ? null
      : `Pool price ${formatCentsTenths(pool.marketPriceCents)}`,
  ].filter((part) => part !== null);

  return (
    <tr>
      <td
        className="border-y border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-2 text-center text-[11px] tracking-[0.06em] text-[var(--text-secondary)] uppercase"
        colSpan={4}
      >
        {parts.length > 0 ? parts.join(" · ") : "Pool price pending"}
      </td>
    </tr>
  );
}

function EmptyHalfRow({ label }: { label: string }) {
  return (
    <tr>
      <td className="px-2 py-3 text-center text-[var(--text-muted)]" colSpan={4}>
        {label}
      </td>
    </tr>
  );
}
