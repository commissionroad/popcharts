"use client";

import { useMemo, useState } from "react";

import { MarketCard } from "@/components/ui/market-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  type Market,
  MARKET_CATEGORIES,
  type MarketCategory,
} from "@/domain/markets/types";
import { cn } from "@/lib/cn";

const filters = [
  { label: "Trending", value: "trending" },
  { label: "New", value: "new" },
  { label: "Graduating", value: "graduating" },
  { label: "Ending soon", value: "ending" },
];

export function DiscoveryBoard({ markets }: { markets: Market[] }) {
  const [filter, setFilter] = useState("trending");
  const [category, setCategory] = useState<MarketCategory | "All">("All");

  const visibleMarkets = useMemo(() => {
    return markets.filter((market) => {
      const categoryMatches = category === "All" || market.category === category;
      const filterMatches =
        filter === "graduating" ? market.status === "graduating" : true;

      return categoryMatches && filterMatches;
    });
  }, [category, filter, markets]);

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
          onChange={setFilter}
          options={filters}
          size="sm"
          value={filter}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleMarkets.map((market) => (
          <MarketCard key={market.id} market={market} />
        ))}
      </div>
    </div>
  );
}
