import { expect, test } from "@playwright/test";

import { lifecycleEnv, marketPath } from "./support/lifecycle";
import { createRejectedMarket } from "./support/lifecycle-ui";

/**
 * ADR 0017 C4 journey 2 — rejected creation. A market whose text trips a
 * review policy hard flag is rejected by the real heuristic review runner, and
 * the creator sees the rejected status and the reasons on the market page.
 * There is no money-out moment here; the deliverable is the rejection surface.
 *
 * Runs only under `pnpm lifecycle:e2e` (full local stack), single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle rejected creation", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a policy-violating market is rejected and the creator sees the reasons", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    // "hacked" trips the illegal-activity hard flag, so the heuristic review
    // runner rejects the market on-chain with a reason.
    const marketId = await createRejectedMarket(
      page,
      env,
      "Will the popcharts treasury be hacked before graduation?"
    );

    await page.goto(marketPath(env, marketId));

    // Rejected status renders on the status pill and the AI review verdict.
    await expect(page.getByText("Rejected").first()).toBeVisible({
      timeout: 30_000,
    });
    // The rejection reason is listed in the AI review card's reviewer notes.
    // The card renders a hidden responsive duplicate, so match only the
    // visible instance rather than a DOM-order .first().
    await expect(
      page.getByText(/depend on illegal activity/).filter({ visible: true })
    ).toBeVisible({ timeout: 30_000 });
  });
});
