import { expect, test } from "@playwright/test";

import { lifecycleEnv, marketPath } from "./support/lifecycle";
import {
  createRejectedMarket,
  FORCED_REJECTION_REASON,
} from "./support/lifecycle-ui";

/**
 * ADR 0017 C4 journey 2 — rejected creation. The dev review endpoint forces a
 * `reject` verdict with a known reason, and the creator sees the rejected
 * status and that reason on the market page. There is no money-out moment
 * here; the deliverable is the rejection surface. Review is a controlled input,
 * so this tests the UI, not how the AI reviewer scores a market.
 *
 * Runs only under `pnpm lifecycle:e2e` (full local stack), single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle rejected creation", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a rejected market shows the rejected status and the reason", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    const marketId = await createRejectedMarket(
      page,
      env,
      "Will the rejected-creation e2e market be rejected?"
    );

    await page.goto(marketPath(env, marketId));

    // Rejected status renders on the status pill and the AI review verdict.
    await expect(page.getByText("Rejected").first()).toBeVisible({
      timeout: 30_000,
    });
    // The forced reason is listed in the AI review card's reviewer notes. The
    // card renders a hidden responsive duplicate, so match only the visible
    // instance rather than a DOM-order .first().
    await expect(
      page.getByText(FORCED_REJECTION_REASON).filter({ visible: true })
    ).toBeVisible({ timeout: 30_000 });
  });
});
