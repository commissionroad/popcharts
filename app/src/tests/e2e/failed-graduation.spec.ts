import { expect, test } from "@playwright/test";

import {
  closeMarketForRefund,
  collateralBalance,
  lifecycleEnv,
  marketPath,
  mintCollateral,
  waitForMarketStatus,
} from "./support/lifecycle";
import {
  connectTestWallet,
  createApprovedMarket,
  placeReceiptViaUi,
} from "./support/lifecycle-ui";
import { TEST_WALLET_ADDRESS } from "./support/test-wallet";

/**
 * ADR 0017 C4 journey 3 — failed graduation. A market never reaches its
 * graduation threshold; the deadline passes and refunds open, and the holder
 * claims the full cost back through the app. Setup rides the real stack
 * (create, review approval, receipt, dev close → markRefundable); the refund
 * itself happens in the browser with the injected wallet.
 *
 * Runs only under `pnpm lifecycle:e2e` (full local stack), single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle failed graduation", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a sub-threshold market opens refunds and the holder claims the cost back", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    await mintCollateral(env, 1_000n * 10n ** 18n);

    const marketId = await createApprovedMarket(
      page,
      env,
      "Will the failed-graduation e2e market reach its threshold?"
    );

    // One YES receipt with no matching NO leaves the matched cap at zero, so
    // the market can never graduate — the failed-graduation condition.
    await placeReceiptViaUi(page, env, marketId, { budget: "50" });

    // The dev close jumps to the graduation deadline and marks the market
    // refundable on-chain; the indexed status becomes `refunded`.
    await closeMarketForRefund(env, marketId);
    await waitForMarketStatus(env, marketId, "refunded");

    const balanceBefore = await collateralBalance(env, TEST_WALLET_ADDRESS);

    await page.goto(marketPath(env, marketId));
    await connectTestWallet(page);

    // The receipt panel offers the full refund; claiming pays the cost back.
    // The refund-claimable receipt is projected by the indexer from the
    // markRefundable event, which can lag the dev endpoint's status write, so
    // give the page's poll time to surface it.
    await expect(page.getByText(/refund available/).first()).toBeVisible({
      timeout: 30_000,
    });
    const claim = page.getByRole("button", { name: "Claim refund" });
    await claim.waitFor({ state: "visible" });
    await claim.dispatchEvent("click");

    await expect(page.getByText("Refund claimed")).toBeVisible({
      timeout: 60_000,
    });

    const balanceAfter = await collateralBalance(env, TEST_WALLET_ADDRESS);
    expect(balanceAfter > balanceBefore).toBe(true);
  });
});
