import { expect, test } from "@playwright/test";

test("@smoke user can move through the primary launchpad surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Markets popping off" })
  ).toBeVisible();

  await page
    .getByRole("link", { name: /Will ETH flip/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /Will ETH flip/ })).toBeVisible();
  await expect(page.getByText("Place a receipt")).toBeVisible();
  await expect(page.getByText("Not a guaranteed fill")).toBeVisible();

  await page.getByRole("link", { name: /View graduation clearing/i }).click();
  await expect(page.getByRole("heading", { name: /Will ETH flip/ })).toBeVisible();
  await expect(page.getByText("Band-pass clearing")).toBeVisible();

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Bake a market" })).toBeVisible();
  await expect(page.getByText("Bets are receipts, not fills")).toBeVisible();
  await page.getByRole("button", { name: "Review market" }).click();
  await expect(page.getByText("Fix 2 fields to review this market.")).toBeVisible();
  await expect(page.getByLabel("Market question")).toBeFocused();
  await page.getByLabel("Market question").fill("Will the smoke test market graduate?");
  await page
    .getByLabel("Resolution criteria")
    .fill("Resolves YES if this mocked market reaches graduation.");
  await page.getByRole("button", { name: "Review market" }).click();
  await expect(page.getByText("Metadata hash")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create market" })).toBeVisible();

  await page.getByRole("link", { name: "Portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "Receipts and backed positions" })
  ).toBeVisible();
});
