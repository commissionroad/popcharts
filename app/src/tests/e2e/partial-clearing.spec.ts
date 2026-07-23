import { expect, test } from "@playwright/test";

import {
  collateralBalance,
  graduateMarketPartial,
  lifecycleEnv,
  mintCollateral,
  waitForMarketStatus,
} from "./support/lifecycle";
import { connectTestWallet, createApprovedMarket } from "./support/lifecycle-ui";
import { assemblePartialClearingBook } from "./support/pregrad-book";
import { TEST_WALLET_ADDRESS } from "./support/test-wallet";

/**
 * ADR 0017 C4 journey 4 — partial clearing. A crowded receipt book graduates on
 * a genuine band-pass split: the matched bands are retained as outcome tokens
 * and the crowded side's prorated excess is refunded. The holder sees both
 * portions itemized on the portfolio, and the refund raises their balance.
 *
 * The book is assembled on-chain by share count (the UI ticket is budget-based,
 * too coarse for band sizing) from the injected test wallet, so the browser
 * redeems the same receipts. Runs only under `pnpm lifecycle:e2e`,
 * single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle partial clearing", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a crowded book graduates on a partial split, itemized for the holder", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    // Fund generously up front so book placement never waits on a mint.
    await mintCollateral(env, 1_000_000n * 10n ** 18n);

    const marketId = await createApprovedMarket(
      page,
      env,
      "Will the partial-clearing e2e market graduate on a split book?"
    );

    // A balanced book to the threshold plus a one-sided YES excess makes YES
    // the crowded side.
    await assemblePartialClearingBook(env, marketId);

    const balanceBefore = await collateralBalance(env, TEST_WALLET_ADDRESS);

    // Real band-pass clearing (force=false) prorates the crowded YES excess to
    // refund; the dev flow claims every receipt, so the refund lands on-chain.
    await graduateMarketPartial(env, marketId);
    await waitForMarketStatus(env, marketId, "graduated");

    // The refund from the prorated excess raises the wallet's collateral.
    const balanceAfter = await collateralBalance(env, TEST_WALLET_ADDRESS);
    expect(balanceAfter > balanceBefore).toBe(true);

    // The portfolio itemizes the split: a settled YES receipt shows the
    // retained tokens and, because YES was crowded, the refunded collateral.
    await page.goto("/portfolio");
    await connectTestWallet(page);
    await expect(
      page.getByText("Settled").filter({ visible: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .getByText(/YES tokens \+ \$.* refunded/)
        .filter({ visible: true })
        .first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
