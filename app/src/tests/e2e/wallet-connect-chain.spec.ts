import { expect, test } from "@playwright/test";

import {
  connectTestWallet,
  installTestWallet,
  TEST_WALLET_ADDRESS_PATTERN,
} from "./support/test-wallet";

test("@chain wallet connects through the injected test provider", async ({ page }) => {
  test.skip(
    process.env.POPCHARTS_E2E_CHAIN !== "true",
    "Set POPCHARTS_E2E_CHAIN=true to run devchain-backed tests."
  );

  await installTestWallet(page);

  await page.goto("/");
  // Polls for the account rather than clicking a button that wagmi's
  // auto-reconnect may remove first; see connectTestWallet.
  await connectTestWallet(page);

  // The header button swaps to the connected account chip once wagmi
  // resolves the injected provider and the local chain acknowledges it.
  await expect(page.getByText(TEST_WALLET_ADDRESS_PATTERN)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
});
