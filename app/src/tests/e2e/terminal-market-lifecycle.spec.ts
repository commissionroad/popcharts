import { expect, test } from "@playwright/test";

import {
  cancelPostgradMarket,
  collateralBalance,
  lifecycleEnv,
  marketPath,
  waitForMarketStatus,
} from "./support/lifecycle";
import { connectTestWallet, createFundedGraduatedMarket } from "./support/lifecycle-ui";
import { TEST_WALLET_ADDRESS } from "./support/test-wallet";

/**
 * ADR 0017 C4 journey 5 — cancelled/draw. A graduated market is cancelled by
 * the resolver (the ADR 0018 draw path), and the holder redeems both legs at
 * half value through the app's redemption surface. The setup (create, review
 * approval, fund, graduate, cancel) walks the same stack a user's actions
 * would; the terminal-surface assertions and the redemption happen in the
 * browser with the injected test wallet.
 *
 * The golden journey (golden-journey.spec.ts) covers the resolved-and-redeem
 * path. Both run only under `pnpm lifecycle:e2e`, single-worker: they sign
 * from the same wallet and operator accounts, so parallel workers race nonces.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle terminal market surfaces", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — these specs need the full local stack."
  );

  test("draw-cancelled market shows the draw and redeems at half value", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    const marketId = await createFundedGraduatedMarket(
      page,
      env,
      "Will the lifecycle e2e market end in a draw?"
    );

    const graduated = await waitForMarketStatus(env, marketId, "graduated");
    const marketAddress = graduated.postgrad?.marketAddress;
    expect(marketAddress).toBeTruthy();

    await cancelPostgradMarket(env, marketAddress as `0x${string}`);
    const market = await waitForMarketStatus(env, marketId, "cancelled", {
      until: (candidate) => Boolean(candidate.resolution),
    });
    expect(market.resolution?.kind).toBe("cancelled");
    // Slice-1 contract: the draw keeps its venue payload too.
    expect(market.postgrad?.marketAddress).toBeTruthy();

    const balanceBefore = await collateralBalance(env, TEST_WALLET_ADDRESS);

    await page.goto(marketPath(env, marketId));
    await connectTestWallet(page);

    // The outcome eyebrow renders in both the summary and the position
    // panel; any visible instance proves the surface.
    await expect(page.getByText("Cancelled - draw").first()).toBeVisible();
    await expect(
      page.getByText(/tokens both redeem at half value/).first()
    ).toBeVisible();
    await expect(page.getByText("Place a receipt")).toHaveCount(0);

    await expect(page.getByText("Claim redemption")).toBeVisible();
    const claim = page.getByRole("button", { name: /^Claim \$/ });
    await claim.waitFor({ state: "visible" });
    await claim.dispatchEvent("click");

    await expect(page.getByText(/^Claimed/)).toBeVisible({ timeout: 60_000 });

    const balanceAfter = await collateralBalance(env, TEST_WALLET_ADDRESS);
    expect(balanceAfter > balanceBefore).toBe(true);
  });
});
