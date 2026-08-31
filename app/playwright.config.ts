import { defineConfig, devices } from "@playwright/test";

const appPort = process.env.PLAYWRIGHT_APP_PORT ?? "3000";
const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${appPort}`;
// Chain and lifecycle lanes both run the app against a real local stack, so
// the webServer boots plain `next dev` reading the generated env block
// instead of the fixture-mode overrides.
const chainE2eEnabled =
  process.env.POPCHARTS_E2E_CHAIN === "true" ||
  process.env.POPCHARTS_E2E_LIFECYCLE === "true";
// Sandboxes that cannot reach the Playwright CDN ship a preinstalled browser
// whose build number will not match the one this Playwright version expects,
// so the bundled-browser lookup fails and the download that would fix it is
// blocked. Pointing at the preinstalled binary is the documented escape hatch.
// Unset -- the case everywhere else, including CI -- leaves Playwright to
// resolve its own browser exactly as before.
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// `next dev` compiles each route the first time a test reaches it, and on a
// small container that can outrun the 5s default assertion timeout even though
// nothing is wrong. Raising it there costs a slow run; hard-coding a larger
// value everywhere would blunt the suite's ability to catch a real hang, so it
// stays opt-in and unset here and in CI.
const expectTimeoutMs = process.env.PLAYWRIGHT_EXPECT_TIMEOUT_MS;
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
  ...(expectTimeoutMs === undefined
    ? {}
    : { expect: { timeout: Number(expectTimeoutMs) } }),
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutablePath === undefined
          ? {}
          : { launchOptions: { executablePath: chromiumExecutablePath } }),
      },
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
