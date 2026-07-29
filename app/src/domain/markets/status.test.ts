import { describe, expect, it } from "vitest";

import { hasGraduated, isAwaitingResolution } from "./status";
import type { MarketStatus } from "./types";

/**
 * Both predicates for every status, stated exhaustively. The `satisfies
 * Record<MarketStatus, …>` is the point: a status added to the API contract is
 * a compile error here until someone decides what it means, which is exactly
 * the guard the dispute-window append (`resolution_pending`/`disputed`) did
 * not have when it silently left every `status === "graduated"` gate behind.
 */
const EXPECTED = {
  bootstrap: { awaitingResolution: false, graduated: false },
  // Ambiguous by status alone — a postgrad draw graduated, a pregrad
  // admin-cancel did not — so it reads false and the surfaces that care
  // disambiguate with the terminal resolution event.
  cancelled: { awaitingResolution: false, graduated: false },
  disputed: { awaitingResolution: true, graduated: true },
  graduated: { awaitingResolution: true, graduated: true },
  graduating: { awaitingResolution: false, graduated: false },
  refunded: { awaitingResolution: false, graduated: false },
  rejected: { awaitingResolution: false, graduated: false },
  resolution_pending: { awaitingResolution: true, graduated: true },
  // Graduated, but its outcome is final: no longer awaiting resolution.
  resolved: { awaitingResolution: false, graduated: true },
  under_review: { awaitingResolution: false, graduated: false },
} as const satisfies Record<
  MarketStatus,
  { awaitingResolution: boolean; graduated: boolean }
>;

describe("market status predicates", () => {
  it.each(Object.entries(EXPECTED))(
    "classifies %s",
    (status, { awaitingResolution, graduated }) => {
      expect(hasGraduated(status as MarketStatus)).toBe(graduated);
      expect(isAwaitingResolution(status as MarketStatus)).toBe(awaitingResolution);
    }
  );

  it("treats every dispute-window status as graduated", () => {
    // The regression this module exists for: a market spends its whole
    // dispute window in one of these, and every surface that asked
    // `status === "graduated"` fell through to its pregrad branch.
    for (const status of ["resolution_pending", "disputed"] as const) {
      expect(hasGraduated(status)).toBe(true);
      expect(isAwaitingResolution(status)).toBe(true);
    }
  });
});
