"use client";

import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

/**
 * The board's category filter, as multi-select chips (repo ADR 0013 "richer
 * category filtering"). Today's board is single-select — one category or All —
 * which cannot express "Politics or Econ", the shape people actually want on a
 * board this mixed.
 *
 * "All" is not a category: it is the empty selection, rendered as a chip so
 * the row has an obvious way back. Selecting it clears rather than selects,
 * and it lights up whenever nothing else is chosen.
 *
 * Chips stay on the shared accent rather than taking each category's card
 * colour. The colours exist to tell cards apart in a dense grid; replayed
 * across seven always-visible chips they turn the header into the loudest
 * thing on the page, and the row stops reading as a control.
 */
export function CategoryFilterChips({
  onClear,
  onToggle,
  selected,
}: {
  onClear: () => void;
  onToggle: (category: MarketCategory) => void;
  selected: readonly MarketCategory[];
}) {
  const allSelected = selected.length === 0;

  return (
    <div aria-label="Filter by category" className="flex flex-wrap gap-2" role="group">
      {/* Named "All categories" for assistive tech: the status views carry an
          "All" of their own, and two buttons with one name in the same header
          are indistinguishable read aloud. The visible word stays "All", which
          the accessible name still contains. */}
      <Chip
        ariaLabel="All categories"
        label="All"
        onClick={onClear}
        selected={allSelected}
      />
      {MARKET_CATEGORIES.map((category) => (
        <Chip
          key={category}
          label={category}
          onClick={() => onToggle(category)}
          selected={selected.includes(category)}
        />
      ))}
    </div>
  );
}

function Chip({
  ariaLabel,
  label,
  onClick,
  selected,
}: {
  ariaLabel?: string;
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={cn(
        "focus-ring rounded-[var(--radius-pill)] border px-3.5 py-2 font-mono text-xs tracking-[0.06em] transition-colors duration-[var(--duration-fast)]",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
