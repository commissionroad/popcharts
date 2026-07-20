import { expect, test } from "@playwright/test";

function dateTimeLocalAfter(milliseconds: number) {
  const date = new Date(Date.now() + milliseconds);
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("@chain user can create a market on the configured devchain", async ({ page }) => {
  test.skip(
    process.env.POPCHARTS_E2E_CHAIN !== "true",
    "Set POPCHARTS_E2E_CHAIN=true to run devchain-backed tests."
  );

  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "Bake a market" })).toBeVisible();

  await page.getByLabel("Market question").fill("Will the chain smoke market exist?");
  await page
    .getByLabel("Resolution criteria")
    .fill("Resolves YES if the local devchain transaction creates this market.");
  await page.getByLabel("Graduation deadline").fill(dateTimeLocalAfter(90 * 60_000));
  await page
    .getByLabel("Resolution deadline")
    .fill(dateTimeLocalAfter(2 * 24 * 60 * 60_000));
  await page.getByRole("button", { name: "Review market" }).click();

  await expect(page.getByText("Metadata hash")).toBeVisible();
  await page.getByRole("button", { name: "Create market" }).click();

  // A real devchain transaction confirms behind this first assertion, so it
  // gets explicit headroom over the 5s default. The mode eyebrow proves the
  // market went on-chain (mock mode renders "Mock created" instead).
  await expect(page.getByText(/Wallet-signed|Devchain relay/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Market under review")).toBeVisible();
  await expect(page.getByText("Market ID")).toBeVisible();
  await expect(page.getByText("Transaction", { exact: true })).toBeVisible();
  await expect(page.getByText(/^0x[0-9a-fA-F]{64}$/).first()).toBeVisible();
});
