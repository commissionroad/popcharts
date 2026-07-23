import { expect, test } from "@playwright/test";

import {
  collateralBalance,
  lifecycleEnv,
  marketPath,
  resolveMarket,
  waitForMarketStatus,
} from "./support/lifecycle";
import {
  buyPostgradTokensViaUi,
  connectTestWallet,
  createFundedGraduatedMarket,
} from "./support/lifecycle-ui";
import { TEST_WALLET_ADDRESS } from "./support/test-wallet";

/**
 * ADR 0017 C4 journey 1 — the golden path. A market walks its entire life
 * through the app with the injected wallet: create → review approval →
 * pre-graduation receipt → graduation → post-graduation trade → resolution →
 * redeem winnings. Every step a user takes happens in the browser; the
 * assertion is the user-visible money-out moment (the claimed payout and a
 * risen collateral balance), not the paper trail (the C3 service scenarios
 * own that).
 *
 * Runs only under `pnpm lifecycle:e2e`, which boots the full local stack
 * (chain, Postgres, API, indexer, heuristic review runner). Single-worker
 * (see test:e2e:lifecycle): the wallet and operator accounts are shared, so
 * parallel workers would race nonces on-chain.
 */

const LIFECYCLE_TIMEOUT_MS = 360_000;

test.describe("@lifecycle golden journey", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("create → trade → graduate → trade → resolve → redeem winnings", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    // Create, get reviewed into bootstrap, buy a YES receipt, and graduate —
    // all through the app. The test wallet now holds YES outcome tokens.
    const marketId = await createFundedGraduatedMarket(
      page,
      env,
      "Will the golden-journey e2e market resolve YES?"
    );

    // Post-graduation trade: buy more YES on the venue with a market order.
    await buyPostgradTokensViaUi(page, env, marketId, { collateral: "20" });

    // Resolve YES through the dev endpoint (jumps chain time past the gate).
    await resolveMarket(env, marketId, "yes");
    const market = await waitForMarketStatus(env, marketId, "resolved", {
      until: (candidate) => Boolean(candidate.resolution?.winningSide),
    });
    expect(market.resolution?.winningSide).toBe("yes");

    // Redeem winnings through the claim panel; the money-out moment is the
    // claimed payout and a risen collateral balance.
    const balanceBefore = await collateralBalance(env, TEST_WALLET_ADDRESS);

    await page.goto(marketPath(env, marketId));
    await connectTestWallet(page);

    await expect(page.getByText(/Resolved - .* wins/).first()).toBeVisible();
    await expect(page.getByText("Claim winnings")).toBeVisible();
    const claim = page.getByRole("button", { name: /^Claim \$/ });
    await claim.waitFor({ state: "visible" });
    await claim.dispatchEvent("click");

    await expect(page.getByText(/^Claimed/)).toBeVisible({ timeout: 60_000 });

    const balanceAfter = await collateralBalance(env, TEST_WALLET_ADDRESS);
    expect(balanceAfter > balanceBefore).toBe(true);
  });
});
