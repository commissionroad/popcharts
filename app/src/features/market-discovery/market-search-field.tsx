"use client";

import { LoaderCircle, Search, X } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * What the field reports about the read behind the query. `loading` and
 * `error` describe the *search*, not the input: the text stays editable in
 * every state, because a failed or in-flight search is the moment a user is
 * most likely to want to change what they typed.
 */
export type MarketSearchState = "error" | "idle" | "loading";

/**
 * The discovery board's free-text search input (repo ADR 0013 "market
 * search"). Fully controlled — it owns no query state, no debounce, and no
 * fetch, so the eventual server-side search wires in by passing a different
 * `onChange` and `state`.
 *
 * The trailing slot carries exactly one affordance at a time: the spinner
 * while a search is in flight, otherwise a clear button once there is
 * something to clear, otherwise nothing. Two controls in that corner read as
 * a toolbar; one reads as a text field.
 */
export function MarketSearchField({
  id = "market-search",
  onChange,
  onClear,
  placeholder = "Search markets",
  state = "idle",
  value,
}: {
  id?: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  state?: MarketSearchState;
  value: string;
}) {
  const loading = state === "loading";

  return (
    <div className="min-w-0 flex-1" role="search">
      <label className="sr-only" htmlFor={id}>
        Search markets
      </label>
      <div
        className={cn(
          "flex h-11 items-center gap-2.5 rounded-[var(--radius-sm)] border bg-[var(--surface-raised)] px-3.5 transition-colors duration-[var(--duration-fast)] focus-within:border-[var(--pc-cyan)]",
          state === "error" ? "border-[var(--no-border)]" : "border-[var(--border)]"
        )}
      >
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--text-muted)]"
        />
        <input
          autoComplete="off"
          className="w-full min-w-0 border-0 bg-transparent text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] [&::-webkit-search-cancel-button]:hidden"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={value}
        />
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin text-[var(--text-muted)]"
          />
        ) : value ? (
          <button
            aria-label="Clear search"
            className="focus-ring -mr-1 shrink-0 rounded-[var(--radius-pill)] p-1 text-[var(--text-muted)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--text-primary)]"
            onClick={onClear}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
