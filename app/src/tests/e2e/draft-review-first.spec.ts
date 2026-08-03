import { expect, type Page, test } from "@playwright/test";

import { lifecycleEnv, marketPath, waitForMarketStatus } from "./support/lifecycle";
import { connectTestWallet, installTestWallet } from "./support/test-wallet";

/**
 * ADR 0022 review-first creation journeys, driven through the real browser
 * flow against the full local stack. The draft review runs in-process with
 * the API using the deterministic heuristic provider, so verdicts here are
 * controlled inputs: a non-binary question always comes back
 * changes-requested, a private-knowledge question always rejects, and a
 * well-formed sourced question always approves.
 *
 * Runs only under `pnpm lifecycle:e2e` (full local stack), single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;

/** Heuristic reviews land in seconds; budget for polling, not for a model. */
const REVIEW_VERDICT_TIMEOUT_MS = 30_000;

test.describe("@lifecycle review-first drafts", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a weak draft gets fix-it feedback, approves after the fix, and publishes live", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();
    const runTag = Date.now().toString(36);

    await openCreatePage(page, env);

    // A vague, non-binary question with otherwise complete fields.
    await page.getByLabel("Market question").fill(`Bitcoin to the moon soon ${runTag}`);
    await page
      .getByLabel("Resolution criteria")
      .fill("Resolves YES per the CoinGecko BTC/USD daily close.");
    await page.getByLabel("Resolution sources").fill("https://www.coingecko.com");
    await page.getByRole("button", { name: "Submit for AI review" }).click();

    // The reviewer answers with actionable feedback, inline and in the panel.
    await expect(page.getByText("Changes requested")).toBeVisible({
      timeout: REVIEW_VERDICT_TIMEOUT_MS,
    });
    await expect(
      page.getByText("Phrase it as a yes/no question").first()
    ).toBeVisible();
    await expect(page.getByText("How to fix").first()).toBeVisible();

    // Fix the question; the draft returns to editing with feedback pinned.
    await page
      .getByLabel("Market question")
      .fill(`Will bitcoin close above $150k during 2027? (${runTag})`);
    await page.getByRole("button", { name: "Resubmit as is" }).click();

    await expect(page.getByText("Approved", { exact: true })).toBeVisible({
      timeout: REVIEW_VERDICT_TIMEOUT_MS,
    });
    await expect(page.getByText("Ready to go live whenever you are")).toBeVisible();

    // Publish & pay signs createMarket with the server-minted params.
    await page.getByRole("button", { name: "Publish & pay" }).click();
    await expect(page.getByText("Market live")).toBeVisible({
      timeout: 60_000,
    });

    const marketId = await readPublishedMarketId(page);

    // Publish bridge-approves on-chain; wait for the indexer to project the
    // market before loading its page (it 404s until the row exists).
    await waitForMarketStatus(env, marketId, "bootstrap");

    // The market page shows a real, tradeable bootstrap market.
    await page.goto(marketPath(env, marketId));
    await expect(
      page.getByRole("heading", {
        name: `Will bitcoin close above $150k during 2027? (${runTag})`,
      })
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Bootstrap", { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("a policy-violating draft is rejected with a blocker", async ({ page }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();
    const runTag = Date.now().toString(36);

    await openCreatePage(page, env);

    await page
      .getByLabel("Market question")
      .fill(`Will my roommate move out by December? (${runTag})`);
    await page.getByLabel("Resolution criteria").fill("I will know when it happens.");
    await page.getByRole("button", { name: "Submit for AI review" }).click();

    await expect(page.getByText("Not approved")).toBeVisible({
      timeout: REVIEW_VERDICT_TIMEOUT_MS,
    });
    await expect(page.getByText("Make it publicly checkable").first()).toBeVisible();
    await expect(page.getByText("Blocker").first()).toBeVisible();
  });

  test("the studio shelves drafts, saves templates, and clones a market", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();
    const runTag = Date.now().toString(36);
    const question = `Will the studio journey market resolve YES? (${runTag})`;

    // Leave a draft behind through the create flow.
    await openCreatePage(page, env);
    await page.getByLabel("Market question").fill(question);
    await page
      .getByLabel("Resolution criteria")
      .fill("Resolves YES per the official announcement.");
    // Autosave debounce is sub-second; the saved chip confirms persistence.
    await expect(page.getByText(/Saved · draft #\d+/)).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/studio");
    await connectTestWallet(page);

    const card = page.locator("article", { hasText: question }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Shelve it as a template; it appears under the Templates tab.
    await card.getByRole("button", { name: "Template", exact: true }).click();
    await page.getByRole("button", { name: "Templates" }).click();
    await expect(page.locator("article", { hasText: question }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Clone any live market from the board into a fresh draft.
    await page.getByRole("button", { name: "All", exact: true }).click();
    const before = await page.locator("article").count();

    await page.getByRole("button", { name: "Start from a market" }).click();
    const cloneAction = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: /Clone/ }) })
      .first()
      .getByRole("button", { name: /Clone/ });

    if (await cloneAction.isVisible()) {
      await cloneAction.click();
      await expect(async () => {
        expect(await page.locator("article").count()).toBeGreaterThan(before);
      }).toPass({ timeout: 15_000 });
    }
  });
});

async function openCreatePage(page: Page, env: ReturnType<typeof lifecycleEnv>) {
  await installTestWallet(page, { rpcUrl: env.rpcUrl });
  await page.goto("/create");
  await connectTestWallet(page);
}

/** Reads the market id off the published panel's summary row. */
async function readPublishedMarketId(page: Page): Promise<bigint> {
  const panel = page.getByText("Market id").locator("..");
  const value = await panel.locator("div").last().innerText();
  const match = value.trim().match(/\d+/);

  if (!match) {
    throw new Error(`Could not read a market id from "${value}".`);
  }

  return BigInt(match[0]);
}
