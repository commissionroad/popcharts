"use client";

import { useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { type Market, type MarketSide, marketSideLabel } from "@/domain/markets/types";
import { parseApiMarketAppId } from "@/lib/app-id";

import { OrderBookLadder } from "./order-book-ladder";
import { buildOrderBookPoolView, hasIndexedPools } from "./order-book-model";
import { type OrderBookLookup, useOrderBook } from "./use-order-book";

/**
 * Main-column card for a graduated market's venue order book. YES and NO
 * outcome tokens trade in independent pools, so the card shows one pool's
 * depth ladder at a time behind an outcome toggle. Only API-backed markets
 * have an indexed book; fixture-backed markets render nothing.
 */
export function OrderBookCard({ market }: { market: Market }) {
  const lookup = resolveOrderBookLookup(market);
  const [side, setSide] = useState<MarketSide>("yes");
  const { book, error, loading } = useOrderBook(lookup);

  if (!lookup) {
    return null;
  }

  const pool = book ? (side === "yes" ? book.yes : book.no) : undefined;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Order book
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            Resting maker orders on the bounded venue. Refreshes every 5 seconds.
          </p>
        </div>
        <SegmentedControl
          accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
          onChange={(value) => setSide(value as MarketSide)}
          options={[
            { label: marketSideLabel(market, "yes"), value: "yes" },
            { label: marketSideLabel(market, "no"), value: "no" },
          ]}
          size="sm"
          value={side}
        />
      </div>

      {loading ? (
        <p className="py-6 text-center font-mono text-xs text-[var(--text-muted)]">
          Loading order book…
        </p>
      ) : null}

      {!loading && !book && error ? (
        <p className="py-6 text-center font-mono text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {book && !hasIndexedPools(book) ? (
        <p className="py-6 text-center font-mono text-xs text-[var(--text-muted)]">
          Venue pools are not indexed yet. The book appears once the postgrad handoff
          lands onchain.
        </p>
      ) : null}

      {book && hasIndexedPools(book) ? (
        pool ? (
          <OrderBookLadder
            pool={buildOrderBookPoolView(pool)}
            sideLabel={marketSideLabel(market, side)}
          />
        ) : (
          <p className="py-6 text-center font-mono text-xs text-[var(--text-muted)]">
            The {marketSideLabel(market, side)} pool is not indexed yet.
          </p>
        )
      ) : null}

      {book && error ? (
        <p className="mt-3 font-mono text-[11px] text-[var(--warning)]">
          Live updates interrupted — showing the last indexed book.
        </p>
      ) : null}
    </section>
  );
}

function resolveOrderBookLookup(market: Market): OrderBookLookup | null {
  if (market.chainId === undefined) {
    return null;
  }

  const parsed = parseApiMarketAppId(market.id);

  return parsed ? { chainId: parsed.chainId, marketId: parsed.marketId } : null;
}
