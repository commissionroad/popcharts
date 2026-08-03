import { expect, test } from "@playwright/test";

import { lifecycleEnv } from "./support/lifecycle";
import { connectTestWallet, installTestWallet } from "./support/test-wallet";

/**
 * ADR 0017 C4 journey 2 — rejected creation, updated for review-first
 * creation (ADR 0022). A rejection now happens on the off-chain draft before
 * anything touches the chain: the creator keeps the draft, sees why it was
 * rejected and how to fix it, and pays nothing. The old on-chain `rejected`
 * market surface this journey used to assert no longer exists in the create
 * path. The heuristic reviewer's private-knowledge rule makes the verdict a
 * deterministic, controlled input — no AI dependency.
 *
 * Runs only under `pnpm lifecycle:e2e` (full local stack), single-worker.
 */

const LIFECYCLE_TIMEOUT_MS = 300_000;
const REVIEW_VERDICT_TIMEOUT_MS = 30_000;

test.describe("@lifecycle rejected creation", () => {
  test.skip(
    process.env.POPCHARTS_E2E_LIFECYCLE !== "true",
    "Run via 'pnpm lifecycle:e2e' — this spec needs the full local stack."
  );

  test("a rejected draft keeps the creator's work and explains the rejection", async ({
    page,
  }) => {
    test.setTimeout(LIFECYCLE_TIMEOUT_MS);
    const env = lifecycleEnv();
    const runTag = Date.now().toString(36);
    const question = `Will my roommate adopt a cat this winter? (${runTag})`;

    await installTestWallet(page, { rpcUrl: env.rpcUrl });
    await page.goto("/create");
    await connectTestWallet(page);

    await page.getByLabel("Market question").fill(question);
    await page
      .getByLabel("Resolution criteria")
      .fill("Resolves YES when the cat arrives.");
    await page.getByRole("button", { name: "Submit for AI review" }).click();

    // The rejection lands as draft feedback: status, blocker, and the fix.
    await expect(page.getByText("Not approved")).toBeVisible({
      timeout: REVIEW_VERDICT_TIMEOUT_MS,
    });
    await expect(
      page.getByText("This market can't run as written", { exact: false })
    ).toBeVisible();
    await expect(page.getByText("Make it publicly checkable").first()).toBeVisible();

    // The draft survives the rejection, editable, on the studio's shelf.
    await page.goto("/studio");
    await connectTestWallet(page);
    await page.getByRole("button", { name: "Needs fixes" }).click();

    const card = page.locator("article", { hasText: question }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Rejected")).toBeVisible();
  });
});
