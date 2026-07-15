import { expect, test } from "@playwright/test";

import { installTestWallet } from "./support/test-wallet";

// The truncated form the wallet button renders for hardhat account #3.
const TRUNCATED_TEST_ADDRESS = /0x90F.*906/;

test("@chain wallet connects through the injected test provider", async ({ page }) => {
  test.skip(
    process.env.POPCHARTS_E2E_CHAIN !== "true",
    "Set POPCHARTS_E2E_CHAIN=true to run devchain-backed tests."
  );

  await installTestWallet(page);

  await page.goto("/");
  // The header re-renders on every market-data poll, so an
  // actionability-checked click can chase a detaching node forever;
  // dispatch the click straight to the current node instead.
  const connect = page.getByRole("button", { name: "Connect wallet" });
  await connect.waitFor({ state: "visible" });
  await connect.dispatchEvent("click");

  // The header button swaps to the connected account chip once wagmi
  // resolves the injected provider and the local chain acknowledges it.
  await expect(page.getByText(TRUNCATED_TEST_ADDRESS)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
});
