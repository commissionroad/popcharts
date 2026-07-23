import { expect, type Page } from "@playwright/test";

import { dateTimeLocalAtMs } from "./datetime";
import {
  chainNowMs,
  forceReview,
  graduateMarket,
  type LifecycleEnv,
  marketPath,
  mintCollateral,
  waitForMarketStatus,
} from "./lifecycle";
import { installTestWallet, TEST_WALLET_ADDRESS } from "./test-wallet";

/**
 * Browser actions shared by the `@lifecycle` UI journeys (ADR 0017 C4): the
 * user-facing half of each path — connect, create, place a receipt, trade
 * postgrad — all driven through the real app with the injected test wallet.
 * The chain/API setup verbs (approval-adjacent transitions, terminal state,
 * balances) live in `./lifecycle`.
 *
 * Review is a controlled test input, not a dependency on the AI: journeys force
 * the verdict deterministically through the dev review endpoint (`forceReview`),
 * which writes the review record and submits the matching on-chain transition.
 * We test UI and protocol behavior, not how the AI reviewer scores a market.
 */

/** Default resolution copy for the created markets; its content is immaterial
 * because the review verdict is forced rather than computed from the text. */
export const DEFAULT_RESOLUTION_CRITERIA =
  "Resolves by the lifecycle e2e harness after graduation.";

/** Forced approval is one on-chain tx plus its indexer projection; budget for
 * that, not for an off-thread AI review. */
const REVIEW_INDEXING_TIMEOUT_MS = 30_000;

/**
 * Ensures the injected test wallet is connected. Wagmi auto-reconnects the
 * injected provider on most navigations, so the header may show either the
 * connect button or the connected account chip — wait for whichever appears
 * and only click when a connect button is actually there.
 */
export async function connectTestWallet(page: Page): Promise<void> {
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

/**
 * Creates a market through the real create flow, forces an `approve` review,
 * and waits for the market to reach `bootstrap`. Returns the on-chain id.
 */
export async function createApprovedMarket(
  page: Page,
  env: LifecycleEnv,
  question: string,
  resolutionCriteria = DEFAULT_RESOLUTION_CRITERIA
): Promise<bigint> {
  await installTestWallet(page, { rpcUrl: env.rpcUrl });

  await page.goto("/create");
  await connectTestWallet(page);

  // Chain time, not wall time: an earlier dev resolution may have jumped the
  // chain days ahead, and the contract validates deadlines against it.
  const nowMs = await chainNowMs(env);

  await page.getByLabel("Market question").fill(question);
  await page.getByLabel("Resolution criteria").fill(resolutionCriteria);
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

  const marketId = await readCreatedMarketId(page);

  // Force an approve verdict (record + on-chain approveMarket) rather than
  // waiting on the AI runner; the indexer then projects bootstrap.
  await forceReview(env, marketId, "approve");
  await waitForMarketStatus(env, marketId, "bootstrap", {
    timeoutMs: REVIEW_INDEXING_TIMEOUT_MS,
  });

  return marketId;
}

/** Reads the created market id off the create-success panel. */
export async function readCreatedMarketId(page: Page): Promise<bigint> {
  const bodyText = (await page.locator("body").innerText()).replace(/\n/g, " ");
  // Case-insensitive: the label renders CSS-uppercased, which innerText keeps.
  const idMatch = bodyText.match(/Market ID\s*#?\s*(\d+)/i);
  if (!idMatch) {
    throw new Error("Could not read the created market id from the page.");
  }

  return BigInt(idMatch[1]!);
}

/**
 * Places one pre-graduation receipt through the real ticket: selects the side,
 * funds it with the collateral budget, and confirms placement. Defaults to YES
 * so the holder wins a YES resolution.
 */
export async function placeReceiptViaUi(
  page: Page,
  env: LifecycleEnv,
  marketId: bigint,
  { budget }: { budget: string }
): Promise<void> {
  await page.goto(marketPath(env, marketId));
  await connectTestWallet(page);

  // The receipt ticket defaults to the YES side, which the approvable-journey
  // markets resolve to; funding the budget and placing is all that is needed.
  await page.getByLabel("Collateral budget").fill(budget);
  const place = page.getByRole("button", { name: /Place .* receipt/ });
  await place.waitFor({ state: "visible" });
  await place.dispatchEvent("click");
  await expect(page.getByText("Receipt placed")).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Creates a market, funds the test wallet, buys one YES receipt through the UI,
 * and graduates it (dev clearing claims receipts into outcome tokens). Returns
 * once the API serves the graduated market.
 */
export async function createFundedGraduatedMarket(
  page: Page,
  env: LifecycleEnv,
  question: string
): Promise<bigint> {
  // Fund first so the receipt step never waits on a mint.
  await mintCollateral(env, 1_000n * 10n ** 18n);

  const marketId = await createApprovedMarket(page, env, question);
  await placeReceiptViaUi(page, env, marketId, { budget: "100" });

  await graduateMarket(env, marketId);
  await waitForMarketStatus(env, marketId, "graduated");

  return marketId;
}

/**
 * Buys outcome tokens on a graduated market's postgrad venue with a market
 * order (spend collateral), and waits for the fill. Proves the postgrad
 * trading surface with the injected wallet.
 */
export async function buyPostgradTokensViaUi(
  page: Page,
  env: LifecycleEnv,
  marketId: bigint,
  { collateral }: { collateral: string }
): Promise<void> {
  await page.goto(marketPath(env, marketId));
  await connectTestWallet(page);

  // The ticket defaults to a YES market buy; the precise CTA label below
  // ("Buy YES tokens") fails loudly if those defaults ever change.
  await page.getByLabel("Collateral to spend").fill(collateral);
  const buy = page.getByRole("button", { name: "Buy YES tokens" });
  await buy.waitFor({ state: "visible" });
  await buy.dispatchEvent("click");
  await expect(page.getByText("Order filled")).toBeVisible({ timeout: 60_000 });
}
