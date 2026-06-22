import { expect, test } from "@playwright/test";

function dateTimeLocalAfter(milliseconds: number) {
  const date = new Date(Date.now() + milliseconds);
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("@smoke user can move through the primary launchpad surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Markets popping off" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sign in|connect wallet/i })
  ).toBeVisible();

  await page.goto("/markets/eth-5000-august");
  await expect(page.getByRole("heading", { name: /Will ETH flip/ })).toBeVisible();
  await expect(page.getByText("Place a receipt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Receipt book locked" })).toBeVisible();
  await expect(page.getByText("Not a guaranteed fill")).toBeVisible();

  await page.getByRole("link", { name: /View graduation clearing/i }).click();
  await expect(page.getByRole("heading", { name: /Will ETH flip/ })).toBeVisible();
  await expect(page.getByText("Band-pass clearing")).toBeVisible();

  await page.goto("/markets/fed-cut-next-meeting");
  await expect(page.getByRole("heading", { name: /Will the Fed cut/ })).toBeVisible();
  await expect(page.getByText("Fixture-backed trading preview.")).toBeVisible();
  await expect(page.getByText("Price band")).toBeVisible();
  await page.getByRole("button", { name: "Place mock YES receipt" }).click();
  await expect(page.getByText("Receipt placed")).toBeVisible();

  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Bake a market" })).toBeVisible();
  await expect(page.getByText("Bets are receipts, not fills")).toBeVisible();
  await expect(page.getByRole("button", { name: "1h" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByRole("button", { name: "1w" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "6h" }).click();
  await expect(page.getByRole("button", { name: "6h" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByLabel("Graduation deadline").fill(dateTimeLocalAfter(90 * 60_000));
  await expect(
    page.locator('[data-deadline-custom="graduation-time"]')
  ).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "1d" }).click();
  await expect(page.getByRole("button", { name: "1d" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page
    .getByLabel("Resolution deadline")
    .fill(dateTimeLocalAfter(2 * 24 * 60 * 60_000));
  await expect(
    page.locator('[data-deadline-custom="resolution-time"]')
  ).toHaveAttribute("aria-current", "true");
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
  await expect(
    page.getByRole("button", { name: "Submit for AI review" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit for AI review" }).click();
  await expect(
    page.getByRole("heading", { name: "Submitted for AI review" })
  ).toBeVisible();
  await expect(page.getByText("Review ticket")).toBeVisible();

  await page.getByRole("link", { name: "Portfolio" }).click();
  await expect(
    page.getByRole("heading", { name: "Receipts and backed positions" })
  ).toBeVisible();
  await expect(
    page.getByText("Will the Fed cut rates at the next meeting?")
  ).toBeVisible();
});
