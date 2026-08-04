import { expect, type Page } from "@playwright/test";

import { dateTimeLocalAtMs } from "./datetime";
import {
  chainNowMs,
  depositReviewCredit,
  forceReview,
  graduateMarket,
  type LifecycleEnv,
  marketPath,
  mintCollateral,
  waitForMarketStatus,
} from "./lifecycle";
import {
  connectTestWallet,
  installTestWallet,
  TEST_WALLET_ADDRESS,
} from "./test-wallet";

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

/** Forced approval/rejection is one on-chain tx plus its indexer projection;
 * budget for that, not for an off-thread AI review. */
const REVIEW_INDEXING_TIMEOUT_MS = 30_000;

/**
 * Creates a market through the review-first create flow (ADR 0022): fills a
 * draft, submits it to the in-process heuristic reviewer, and publishes once
 * approved. The default lifecycle questions are deliberately binary
 * ("Will …?"), so the deterministic reviewer always approves them — review
 * stays a controlled input, not an AI dependency. Returns the on-chain id
 * from the published panel.
 */
export async function createMarketViaUi(
  page: Page,
  env: LifecycleEnv,
  question: string,
  resolutionCriteria = DEFAULT_RESOLUTION_CRITERIA
): Promise<bigint> {
  // Fund review credit before touching the page: the submission gate reads
  // the *indexed* deposit, and depositing first gives the indexer the whole
  // form-filling window to catch up. If it still loses the race, the create
  // flow's credit panel auto-resubmits once the deposit lands.
  await depositReviewCredit(env, TEST_WALLET_ADDRESS, 10n ** 18n);
  await installTestWallet(page, { rpcUrl: env.rpcUrl });

  await page.goto("/create");
  await connectTestWallet(page);

  // Chain time, not wall time: an earlier dev resolution may have jumped the
  // chain days ahead, and the contract validates deadlines against it. The
  // draft stores these as relative windows and the server re-anchors them at
  // publish, so a window longer than intended (chain ahead of wall clock) is
  // harmless — the dev graduate/close/resolve endpoints jump to the deadline
  // wherever it lands.
  const nowMs = await chainNowMs(env);

  await page.getByLabel("Market question").fill(question);
  await page.getByLabel("Resolution criteria").fill(resolutionCriteria);
  await page
    .getByLabel("Graduation deadline")
    .fill(dateTimeLocalAtMs(nowMs + 90 * 60_000));
  await page
    .getByLabel("Resolution deadline")
    .fill(dateTimeLocalAtMs(nowMs + 2 * 24 * 60 * 60_000));
  await page.getByRole("button", { name: "Submit for AI review" }).click();

  await expect(page.getByText("Ready to go live whenever you are")).toBeVisible({
    timeout: REVIEW_INDEXING_TIMEOUT_MS,
  });

  await page.getByRole("button", { name: "Publish & pay" }).click();
  await expect(page.getByText("Market live")).toBeVisible({ timeout: 60_000 });

  return readCreatedMarketId(page);
}

/**
 * Creates a market, forces an `approve` review, and waits for the market to
 * reach `bootstrap`. Returns the on-chain id.
 */
export async function createApprovedMarket(
  page: Page,
  env: LifecycleEnv,
  question: string,
  resolutionCriteria = DEFAULT_RESOLUTION_CRITERIA
): Promise<bigint> {
  const marketId = await createMarketViaUi(page, env, question, resolutionCriteria);
  // Publish bridge-approves on-chain (the review happened on the draft); the
  // forced verdict remains a belt-and-braces fallback for the rare case the
  // bridge tx loses a race, and no-ops once the market already transitioned.
  await forceReview(env, marketId, "approve").catch(() => undefined);
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
 * Places one pre-graduation receipt through the real ticket: funds it with the
 * collateral budget and confirms placement. Defaults to the YES side so the
 * holder wins a YES resolution.
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
