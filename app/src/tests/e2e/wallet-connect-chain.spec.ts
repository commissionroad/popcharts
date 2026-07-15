import { expect, test } from "@playwright/test";

import { installTestWallet, TEST_WALLET_ADDRESS } from "./support/test-wallet";

// The wallet button truncates the address (leading and trailing characters
// around an ellipsis); derive both ends from the fixture constant so the
// assertion can never drift from the account the provider reports.
const TRUNCATED_TEST_ADDRESS = new RegExp(
  `${TEST_WALLET_ADDRESS.slice(0, 5)}.*${TEST_WALLET_ADDRESS.slice(-3)}`
);

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
