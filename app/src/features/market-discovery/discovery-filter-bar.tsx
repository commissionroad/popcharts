"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  BOARD_STATUS_FILTERS,
  DEFAULT_BOARD_STATUS_FILTER,
} from "@/domain/markets/board-filters";
import type { MarketCategory } from "@/domain/markets/types";
import { CategoryFilterChips } from "@/features/market-discovery/category-filter-chips";
import {
  MarketSearchField,
  type MarketSearchState,
} from "@/features/market-discovery/market-search-field";

const statusOptions = BOARD_STATUS_FILTERS.map(({ key, label }) => ({
  label,
  value: key,
}));

/**
 * The discovery board's filter header: free-text search and status views on
 * one row, category chips on the next, and a summary strip that appears only
 * once something is actually filtered.
 *
 * That third row is the answer to the obvious risk of adding search beside the
 * existing status chips — that the top of the board turns into a control
 * panel. An unfiltered board renders exactly the two rows it renders today;
 * the strip is *earned* by a filter, and when it appears it is a status line
 * (what you asked for, how much came back, one way out) rather than another
 * bank of controls. It is also the only place "Clear all" lives, so the
 * affordance cannot be hunted for when there is nothing to clear.
 *
 * Presentational and fully controlled: it holds no filter state and issues no
 * reads. Whether a filter runs in SQL or in the browser is the caller's
 * business — the status view is already server-side (repo ADR 0022 P8) while
 * search and category are the halves ADR 0013 still has open.
 */
export function DiscoveryFilterBar({
  categories,
  onCategoriesClear,
  onCategoryToggle,
  onClearAll,
  onQueryChange,
  onQueryClear,
  onStatusChange,
  query,
  resultCount,
  searchState = "idle",
  statusKey = DEFAULT_BOARD_STATUS_FILTER.key,
}: {
  categories: readonly MarketCategory[];
  onCategoriesClear: () => void;
  onCategoryToggle: (category: MarketCategory) => void;
  onClearAll: () => void;
  onQueryChange: (query: string) => void;
  onQueryClear: () => void;
  onStatusChange: (statusKey: string) => void;
  query: string;
  /** Markets currently shown, or null while that number is unknown. */
  resultCount: number | null;
  searchState?: MarketSearchState;
  statusKey?: string;
}) {
  const filtered =
    query.trim() !== "" ||
    categories.length > 0 ||
    statusKey !== DEFAULT_BOARD_STATUS_FILTER.key;

  return (
    <div className="mb-7 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MarketSearchField
          onChange={onQueryChange}
          onClear={onQueryClear}
          state={searchState}
          value={query}
        />
        <SegmentedControl
          onChange={onStatusChange}
          options={statusOptions}
          size="sm"
          value={statusKey}
        />
      </div>

      <CategoryFilterChips
        onClear={onCategoriesClear}
        onToggle={onCategoryToggle}
        selected={categories}
      />

      {filtered ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-3">
          <p
            aria-live="polite"
            className="font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase"
          >
            {summaryLabel({ categories, query, resultCount, searchState, statusKey })}
          </p>
          <button
            className="focus-ring rounded-[var(--radius-pill)] border border-[var(--border)] px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase transition-colors duration-[var(--duration-fast)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            onClick={onClearAll}
            type="button"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The summary strip's sentence: how many markets came back, then what was
 * asked for. Built as a string rather than spans so the whole line reads as
 * one announcement to a screen reader.
 *
 * A search that is in flight or has failed reports no count — a stale number
 * beside a spinner reads as the answer to the query being typed.
 */
export function summaryLabel({
  categories,
  query,
  resultCount,
  searchState,
  statusKey,
}: {
  categories: readonly MarketCategory[];
  query: string;
  resultCount: number | null;
  searchState: MarketSearchState;
  statusKey: string;
}): string {
  const parts: string[] = [];
  const trimmed = query.trim();

  if (trimmed !== "") {
    parts.push(`matching “${trimmed}”`);
  }
  if (categories.length > 0) {
    parts.push(`in ${categories.join(", ")}`);
  }
  const status = BOARD_STATUS_FILTERS.find((filter) => filter.key === statusKey);
  if (status && status.key !== DEFAULT_BOARD_STATUS_FILTER.key) {
    parts.push(status.label);
  }

  const suffix = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";

  if (searchState === "loading") {
    return `Searching…${suffix}`;
  }
  if (searchState === "error" || resultCount === null) {
    return `Results unavailable${suffix}`;
  }

  const count =
    resultCount === 0
      ? "No markets"
      : resultCount === 1
        ? "1 market"
        : `${resultCount} markets`;

  return `${count}${suffix}`;
}
