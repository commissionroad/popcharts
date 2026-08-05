"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { MarketCardLive } from "@/features/market-discovery/market-card-live";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  BOARD_STATUS_FILTERS,
  DEFAULT_BOARD_STATUS_FILTER,
} from "@/domain/markets/board-filters";
import {
  type Market,
  MARKET_CATEGORIES,
  type MarketCategory,
} from "@/domain/markets/types";
import { cn } from "@/lib/cn";

const statusChips = BOARD_STATUS_FILTERS.map(({ key, label }) => ({
  label,
  value: key,
}));

/**
 * The discovery board. Status views are URL state (`?status=<key>`) so the
 * server filters them in SQL (repo ADR 0022 P8) — a chip click replaces the
 * URL and the server component re-reads the list; the live-refresh channel's
 * `router.refresh()` keeps whatever view is active. Categories stay a client
 * filter over the fetched page.
 */
export function DiscoveryBoard({
  activeStatusKey = DEFAULT_BOARD_STATUS_FILTER.key,
  markets,
}: {
  activeStatusKey?: string;
  markets: Market[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState<MarketCategory | "All">("All");

  const visibleMarkets = useMemo(() => {
    return markets.filter(
      (market) => category === "All" || market.category === category
    );
  }, [category, markets]);

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {(["All", ...MARKET_CATEGORIES] as Array<MarketCategory | "All">).map(
            (item) => (
              <button
                className={cn(
                  "focus-ring rounded-[var(--radius-pill)] border px-3.5 py-2 font-mono text-xs tracking-[0.06em] transition-colors",
                  category === item
                    ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                )}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            )
          )}
        </div>
        <SegmentedControl
          onChange={(key) =>
            router.replace(
              key === DEFAULT_BOARD_STATUS_FILTER.key ? "/" : `/?status=${key}`,
              { scroll: false }
            )
          }
          options={statusChips}
          size="sm"
          value={activeStatusKey}
        />
      </div>
      {visibleMarkets.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-[var(--border)] px-4 py-8 text-center font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase"
        >
          No markets match this view yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleMarkets.map((market) => (
            <MarketCardLive key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
