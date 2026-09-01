"use client";

import { RotateCw, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { MarketCard } from "@/components/ui/market-card";
import type { Market } from "@/domain/markets/types";
import type { MarketSearchState } from "@/features/market-discovery/market-search-field";

const PLACEHOLDER_CARDS = 6;

/**
 * The board's results region across the four things a filtered read can be:
 * in flight, failed, empty, or a grid of markets.
 *
 * It renders {@link MarketCard} rather than the board's live island — these
 * are the same cards without the per-market price socket, which a preview or
 * a search result page has no business opening.
 */
export function MarketSearchResults({
  filtered,
  markets,
  onClearFilters,
  onRetry,
  query,
  state = "idle",
}: {
  /** Whether any filter is on — decides which of the empty states applies. */
  filtered: boolean;
  markets: readonly Market[];
  onClearFilters: () => void;
  onRetry: () => void;
  query: string;
  state?: MarketSearchState;
}) {
  if (state === "loading") {
    return <ResultsSkeleton />;
  }

  if (state === "error") {
    return <ResultsError onRetry={onRetry} />;
  }

  if (markets.length === 0) {
    return filtered ? (
      <NoMatches onClearFilters={onClearFilters} query={query} />
    ) : (
      <EmptyBoard />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {markets.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </div>
  );
}

/**
 * The zero-match state, and the one worth spending design on: a search that
 * finds nothing is the most common way a new user meets this board.
 *
 * Three things it has to do. Say what was searched, verbatim and in quotes, so
 * a typo is visible as a typo. Offer the way back out, since a filter the user
 * forgot is the usual culprit. And — only when there was an actual query —
 * offer the create flow: on a prediction market, a question people search for
 * and cannot find is the strongest demand signal the product gets, so the dead
 * end is worth turning into the one action that resolves it.
 *
 * The create link deliberately does not carry the query. `/create` reads only
 * `?draft=`, so a prefill would be a link to a page that ignores it; wiring
 * the question through belongs to the create flow, not to this panel.
 */
function NoMatches({
  onClearFilters,
  query,
}: {
  onClearFilters: () => void;
  query: string;
}) {
  const trimmed = query.trim();

  return (
    <div
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] px-6 py-14 text-center"
      role="status"
    >
      <SearchX aria-hidden="true" className="size-7 text-[var(--text-muted)]" />
      <div className="flex flex-col gap-2">
        <p className="font-display text-xl font-bold text-[var(--text-primary)]">
          {trimmed === ""
            ? "No markets match these filters"
            : `No markets match “${trimmed}”`}
        </p>
        <p className="max-w-[46ch] text-sm leading-6 text-[var(--text-secondary)]">
          {trimmed === ""
            ? "Widen the category or status view to see more of the board."
            : "Check the spelling, widen your filters — or make the market yourself. A question nobody has listed is usually one worth listing."}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <button
          className="focus-ring rounded-[var(--radius-pill)] border border-[var(--border)] px-4 py-2 font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase transition-colors duration-[var(--duration-fast)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          onClick={onClearFilters}
          type="button"
        >
          Clear filters
        </button>
        {trimmed === "" ? null : (
          <Link
            className="focus-ring rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-2 font-mono text-[11px] tracking-[0.1em] text-[var(--accent-content)] uppercase transition-colors duration-[var(--duration-fast)] hover:bg-[var(--accent-pressed)]"
            href="/create"
          >
            Create this market
          </Link>
        )}
      </div>
    </div>
  );
}

/** No filters, no markets: the board itself is empty, not the search. */
function EmptyBoard() {
  return (
    <p
      className="rounded-md border border-[var(--border)] px-4 py-8 text-center font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase"
      role="status"
    >
      No markets match this view yet.
    </p>
  );
}

/**
 * A failed read, kept distinct from "found nothing" — they call for opposite
 * responses, and a search that quietly renders zero results on a 500 teaches
 * users the market does not exist.
 *
 * Local to this feature on purpose: the shared loading/error primitives are a
 * separate ADR 0013 item being designed alongside this one. Adopt them here
 * when they land rather than growing a second set.
 */
function ResultsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--no-border)] bg-[var(--surface-card)] px-6 py-14 text-center"
      role="alert"
    >
      <TriangleAlert aria-hidden="true" className="size-7 text-[var(--danger)]" />
      <div className="flex flex-col gap-2">
        <p className="font-display text-xl font-bold text-[var(--text-primary)]">
          Couldn’t load markets
        </p>
        <p className="max-w-[46ch] text-sm leading-6 text-[var(--text-secondary)]">
          The search didn’t come back. Your filters are still set — retrying keeps them.
        </p>
      </div>
      <button
        className="focus-ring mt-1 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] px-4 py-2 font-mono text-[11px] tracking-[0.1em] text-[var(--text-secondary)] uppercase transition-colors duration-[var(--duration-fast)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        onClick={onRetry}
        type="button"
      >
        <RotateCw aria-hidden="true" className="size-3.5" />
        Try again
      </button>
    </div>
  );
}

/**
 * Card-shaped placeholders at the grid's own dimensions, so results land
 * without the page reflowing under the pointer. Local for the same reason as
 * {@link ResultsError}.
 */
function ResultsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Searching markets"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      role="status"
    >
      {Array.from({ length: PLACEHOLDER_CARDS }, (_, index) => (
        <div
          className="min-h-[360px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6"
          key={index}
        >
          <div className="h-5 w-24 rounded-[var(--radius-pill)] bg-[var(--surface-hover)]" />
          <div className="mt-6 h-6 w-full rounded-[var(--radius-sm)] bg-[var(--surface-hover)]" />
          <div className="mt-2 h-6 w-3/5 rounded-[var(--radius-sm)] bg-[var(--surface-hover)]" />
          <div className="mt-6 flex gap-2.5">
            <div className="h-14 flex-1 rounded-[var(--radius-sm)] bg-[var(--surface-hover)]" />
            <div className="h-14 flex-1 rounded-[var(--radius-sm)] bg-[var(--surface-hover)]" />
          </div>
          <div className="mt-6 h-2 w-full rounded-[var(--radius-pill)] bg-[var(--surface-hover)]" />
        </div>
      ))}
    </div>
  );
}
