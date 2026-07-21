import { DEMO_MARKET_SYMBOL } from "./demoMarket.ts";
import type { PregradDeploy } from "./pregradDeploy.ts";
import {
  readPostgradDeployment,
  type PostgradDeployment,
} from "./readPostgradDeployment.ts";

export type RunCommand = (
  name: string,
  command: string,
  args: readonly string[],
  options?: { readonly env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

/**
 * Deploys the postgrad venue on top of a fresh pregrad deployment: the v4
 * venue stack, the complete-set postgrad contracts, and one demo market so
 * the venue is immediately tradeable. Shared by the local orchestrators
 * (local-dev, local-chain-smoke, local-lifecycle-nightly), which supply
 * their own supervised command runner. The deploy scripts are idempotent
 * against a reused chain (the venue deploy clears stale Ignition journals
 * itself), and every failure rejects loudly through the runner.
 */
export async function deployPostgradVenue(
  run: RunCommand,
  deploy: PregradDeploy,
): Promise<PostgradDeployment> {
  await run("venue", "pnpm", [
    "--dir",
    "protocol",
    "run",
    "local:deploy-venue",
  ]);
  await run(
    "postgrad",
    "pnpm",
    ["--dir", "protocol", "run", "local:deploy-postgrad"],
    {
      env: { POPCHARTS_PREGRAD_MANAGER_ADDRESS: deploy.pregradManagerAddress },
    },
  );
  await run(
    "demo market",
    "pnpm",
    ["--dir", "protocol", "run", "local:create-complete-set-market"],
    {
      env: {
        POPCHARTS_COLLATERAL_ADDRESS: deploy.collateralAddress,
        POPCHARTS_MARKET_SYMBOL: DEMO_MARKET_SYMBOL,
      },
    },
  );

  return readPostgradDeployment(DEMO_MARKET_SYMBOL);
}
