import type { MarketStatus } from "./types";

/**
 * The lifecycle facts the app branches on, recorded once per status instead of
 * re-derived from `status === "graduated"` comparisons in each surface.
 *
 * The table, more than the predicates below it, is the point: `satisfies
 * Record<MarketStatus, …>` makes a status appended to the API contract a
 * compile error here until it answers these questions. The dispute-window
 * append (`resolution_pending`/`disputed`) is the cautionary case — TypeScript
 * forced the exhaustive `Record<MarketStatus, string>` label maps in
 * `status-pill` and `receipt-ticket` to widen, and every *boolean* gate
 * compiled untouched and silently kept showing pregrad UI for markets whose
 * outcome tokens were already trading at a venue.
 *
 * The server keeps the same table beside its `MARKET_STATUSES` definition
 * (`server/src/db/schema/markets.ts`) for its own gates. The two are separate
 * on purpose — the app's `MarketStatus` comes from the generated API client
 * and the app never imports server code — but they answer the same questions,
 * so change them together.
 */
type MarketStatusFacts = {
  /**
   * Whether reaching this status proves the market completed on-chain
   * graduation — a venue and outcome tokens exist, and the pregrad receipt
   * book is history.
   *
   * `cancelled` is deliberately absent from the "after" set: a postgrad draw
   * graduated first, a pregrad admin-cancel never did, and only the terminal
   * resolution event separates them. Every surface that cares already makes
   * that distinction explicitly with `market.resolution`.
   */
  graduated: boolean;
  /** Whether the market is finished: no further status transition follows. */
  terminal: boolean;
};

const MARKET_STATUS_FACTS = {
  bootstrap: { graduated: false, terminal: false },
  cancelled: { graduated: false, terminal: true },
  disputed: { graduated: true, terminal: false },
  graduated: { graduated: true, terminal: false },
  graduating: { graduated: false, terminal: false },
  refunded: { graduated: false, terminal: true },
  rejected: { graduated: false, terminal: true },
  resolution_pending: { graduated: true, terminal: false },
  resolved: { graduated: true, terminal: true },
  under_review: { graduated: false, terminal: false },
} as const satisfies Record<MarketStatus, MarketStatusFacts>;

/**
 * The market completed on-chain graduation, so a holder's stake lives in
 * outcome tokens rather than in the pregrad receipt book. True for the whole
 * dispute window and after resolution.
 */
export function hasGraduated(status: MarketStatus): boolean {
  return MARKET_STATUS_FACTS[status].graduated;
}

/**
 * The market has graduated and its outcome is not final yet — where it spends
 * its entire dispute window (repo ADR 0024). Outcome tokens still trade, so
 * the venue is the price source and the postgrad trading surfaces belong on
 * the page.
 */
export function isAwaitingResolution(status: MarketStatus): boolean {
  const facts = MARKET_STATUS_FACTS[status];
  return facts.graduated && !facts.terminal;
}
