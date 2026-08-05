import { test } from "@playwright/test";

/**
 * Retired by review-first creation (ADR 0022): market creation now runs
 * draft → AI review → publish, which needs the draft API — and the `@chain`
 * lane boots only the devchain and the app, with no API or database. The full
 * creation journey (feedback loop, approval, publish-and-pay, live market) is
 * covered by `draft-review-first.spec.ts` in the `@lifecycle` lane, which
 * boots the whole stack.
 */
test("@chain user can create a market on the configured devchain", async () => {
  test.skip(
    true,
    "Creation moved behind the draft API (ADR 0022) — covered by draft-review-first.spec.ts in the @lifecycle lane."
  );
});
