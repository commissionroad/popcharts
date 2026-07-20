import { expect, type Page, test } from "@playwright/test";

import { dateTimeLocalAtMs } from "./support/datetime";
import {
  approveMarket,
  chainNowMs,
  cancelPostgradMarket,
  collateralBalance,
  graduateMarket,
  lifecycleEnv,
  marketPath,
  mintCollateral,
  resolveMarket,
  waitForMarketStatus,
} from "./support/lifecycle";
import { installTestWallet, TEST_WALLET_ADDRESS } from "./support/test-wallet";

/**
 * ADR 0018 slice 6: walk real markets into both postgrad terminal states and
 * collect through the app. Setup (create, approve, fund, graduate, settle)
 * drives the same stack a user's actions would, then every terminal-surface
 * assertion and the redemption itself happen in the browser with the
 * injected test wallet.
 *
 * Each test costs a few minutes of real chain + indexer time; they only run
 * under `pnpm lifecycle:e2e`, which boots the full local stack. The lane runs
 * single-worker (see test:e2e:lifecycle): both tests sign from the same
 * wallet and operator accounts, so parallel workers race nonces on-chain.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

test.describe("@lifecycle terminal market surfaces", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — these specs need the full local stack."
  );

  test("resolved market shows the outcome and redeems winnings", async ({ page }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    const marketId = await createFundedGraduatedMarket(
      page,
      "Will the lifecycle e2e market resolve YES?"
    );

    await resolveMarket(env, marketId, "yes");
    const market = await waitForMarketStatus(env, marketId, "resolved", {
      until: (candidate) => Boolean(candidate.resolution?.winningSide),
    });
    expect(market.resolution?.winningSide).toBe("yes");
    // Slice-1 contract: terminal status keeps the venue payload.
    expect(market.postgrad?.marketAddress).toBeTruthy();

    const balanceBefore = await collateralBalance(env, TEST_WALLET_ADDRESS);

    await page.goto(marketPath(env, marketId));
    await connectTestWallet(page);

    // Outcome surface: winner named, no pre-graduation affordances.
    // The outcome eyebrow can render in both the summary and the position
    // panel; any visible instance proves the surface.
    await expect(page.getByText(/Resolved - .* wins/).first()).toBeVisible();
    await expect(
      page.getByText(/tokens redeem 1:1 for collateral/).first()
    ).toBeVisible();
    await expect(page.getByText("Place a receipt")).toHaveCount(0);
    await expect(page.getByText("READY TO GRADUATE")).toHaveCount(0);

    // Redemption: the claim panel prices the winning balance and pays out.
    await expect(page.getByText("Claim winnings")).toBeVisible();
    const claim = page.getByRole("button", { name: /^Claim \$/ });
    await claim.waitFor({ state: "visible" });
    await claim.dispatchEvent("click");

    await expect(page.getByText(/^Claimed/)).toBeVisible({ timeout: 60_000 });

    const balanceAfter = await collateralBalance(env, TEST_WALLET_ADDRESS);
    expect(balanceAfter > balanceBefore).toBe(true);
  });

  test("draw-cancelled market shows the draw and redeems at half value", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();

    const marketId = await createFundedGraduatedMarket(
      page,
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

/**
 * Creates a market through the real create flow, approves it as the local
 * review manager, buys a YES receipt with the test wallet through the
 * receipt ticket, and graduates it (dev clearing claims receipts into
 * outcome tokens). Returns once the API serves the graduated market.
 */
async function createFundedGraduatedMarket(
  page: Page,
  question: string
): Promise<bigint> {
  const env = lifecycleEnv();

  // Fund first so the receipt step never waits on a mint.
  await mintCollateral(env, 1_000n * 10n ** 18n);

  await installTestWallet(page, { rpcUrl: env.rpcUrl });

  await page.goto("/create");
  await connectTestWallet(page);

  // Chain time, not wall time: an earlier dev resolution may have jumped the
  // chain days ahead, and the contract validates deadlines against it.
  const nowMs = await chainNowMs(env);

  await page.getByLabel("Market question").fill(question);
  await page
    .getByLabel("Resolution criteria")
    .fill("Resolves by the lifecycle e2e harness after graduation.");
  await page
    .getByLabel("Graduation deadline")
    .fill(dateTimeLocalAtMs(nowMs + 90 * 60_000));
  await page
    .getByLabel("Resolution deadline")
    .fill(dateTimeLocalAtMs(nowMs + 2 * 24 * 60 * 60_000));
  await page.getByRole("button", { name: "Review market" }).click();
  await expect(page.getByText("Metadata hash")).toBeVisible();
  await page.getByRole("button", { name: "Create market" }).click();

  await expect(page.getByText(/Wallet-signed|Devchain relay/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Market ID")).toBeVisible();

  const bodyText = (await page.locator("body").innerText()).replace(/\n/g, " ");
  // Case-insensitive: the label renders CSS-uppercased, which innerText keeps.
  const idMatch = bodyText.match(/Market ID\s*#?\s*(\d+)/i);
  if (!idMatch) {
    throw new Error("Could not read the created market id from the page.");
  }
  const marketId = BigInt(idMatch[1]!);

  // The indexer projects creation as under_review; approval opens trading.
  await waitForMarketStatus(env, marketId, "under_review");
  await approveMarket(env, marketId);
  await waitForMarketStatus(env, marketId, "bootstrap");

  // Buy YES with the test wallet through the real ticket.
  await page.goto(marketPath(env, marketId));
  await page.getByLabel("Collateral budget").fill("100");
  const place = page.getByRole("button", { name: /Place .* receipt/ });
  await place.waitFor({ state: "visible" });
  await place.dispatchEvent("click");
  await expect(page.getByText("Receipt placed")).toBeVisible({
    timeout: 60_000,
  });

  await graduateMarket(env, marketId);
  await waitForMarketStatus(env, marketId, "graduated");

  return marketId;
}

/**
 * Ensures the injected test wallet is connected. Wagmi auto-reconnects the
 * injected provider on most navigations, so the header may show either the
 * connect button or the connected account chip — wait for whichever appears
 * and only click when a connect button is actually there.
 */
async function connectTestWallet(page: Page): Promise<void> {
  const truncated = new RegExp(
    `${TEST_WALLET_ADDRESS.slice(0, 5)}.*${TEST_WALLET_ADDRESS.slice(-3)}`
  );
  const chip = page.getByText(truncated);
  const connect = page.getByRole("button", { name: "Connect wallet" });
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if ((await chip.count()) > 0) {
      return;
    }
    // The connect button can vanish between locating and clicking while
    // wagmi auto-reconnects — a failed click is progress, not an error;
    // the loop re-checks for the chip either way.
    await connect
      .first()
      .dispatchEvent("click", undefined, { timeout: 2_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }

  throw new Error("The test wallet did not connect within 30s.");
}
