import type { MarketStatus } from "./types";

/** One discovery-board status view: a chip, its URL key, and the statuses it asks the API for. */
export type BoardStatusFilter = {
  /** URL value (`?status=<key>`) and chip identity. */
  key: string;
  /** Chip text. */
  label: string;
  /** Statuses sent to the API's `status` filter; empty means no filter. */
  statuses: readonly MarketStatus[];
};

/**
 * The board's status views (repo ADR 0022 P8), filtered server-side in SQL.
 * "Resolving" is the dispute-window pair from repo ADR 0024 — the market has
 * graduated but its outcome is not final; "Graduated" alone is the venue-
 * trading state before anyone requests resolution.
 */
export const BOARD_STATUS_FILTERS: readonly BoardStatusFilter[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "pre-grad", label: "Pre-grad", statuses: ["bootstrap"] },
  { key: "graduating", label: "Graduating", statuses: ["graduating"] },
  { key: "graduated", label: "Graduated", statuses: ["graduated"] },
  {
    key: "resolving",
    label: "Resolving",
    statuses: ["resolution_pending", "disputed"],
  },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] },
  { key: "refunded", label: "Refunded", statuses: ["refunded"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

export const DEFAULT_BOARD_STATUS_FILTER = BOARD_STATUS_FILTERS[0]!;

/**
 * Resolves a `?status=` value to a board view. Unknown or absent values mean
 * the default All view — a shared link with a stale key degrades to the full
 * board rather than an error surface.
 */
export function resolveBoardStatusFilter(value: string | undefined): BoardStatusFilter {
  return (
    BOARD_STATUS_FILTERS.find((filter) => filter.key === value) ??
    DEFAULT_BOARD_STATUS_FILTER
  );
}
