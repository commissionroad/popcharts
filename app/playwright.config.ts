import { defineConfig, devices } from "@playwright/test";

const appPort = process.env.PLAYWRIGHT_APP_PORT ?? "3000";
const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${appPort}`;
// Chain and lifecycle lanes both run the app against a real local stack, so
// the webServer boots plain `next dev` reading the generated env block
// instead of the fixture-mode overrides.
const chainE2eEnabled =
  process.env.POPCHARTS_E2E_CHAIN === "true" ||
  process.env.POPCHARTS_E2E_LIFECYCLE === "true";
const nextDevCommand = `pnpm exec next dev --port ${appPort}`;
const webServerCommand = chainE2eEnabled
  ? nextDevCommand
  : [
      "POPCHARTS_MARKET_DATA_SOURCE=fixtures",
      "NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE=mock",
      "NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN=false",
      "NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_WALLET=false",
      nextDevCommand,
    ].join(" ");

export default defineConfig({
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "playwright-report/report.json" }]]
    : "list",
  retries: process.env.CI ? 2 : 0,
  testDir: "./src/tests/e2e",
  use: {
    baseURL: appBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: webServerCommand,
    reuseExistingServer: !process.env.CI && chainE2eEnabled,
    timeout: 120_000,
    url: appBaseUrl,
  },
});
