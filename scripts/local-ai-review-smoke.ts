#!/usr/bin/env -S node --experimental-strip-types

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_HARDHAT_PRIVATE_KEY } from "./shared/chain/defaultHardhatPrivateKey.ts";
import { parseSmokeMarket } from "./shared/deployments/smokeMarket.ts";
import { parseEnvFile } from "./shared/env/parseEnvFile.ts";
import { localChainEnvFile } from "./shared/env/localDevEnvFiles.ts";
import { collectCommand } from "./shared/process/collectCommand.ts";
import { repoRoot, serverDir } from "./shared/paths.ts";

/**
 * AI review smoke against an already-running local stack (ADR 0017 C2).
 *
 * Requires `pnpm local:smoke -- --keep-running` (or the local dev stack):
 * creates a fresh market on-chain via the protocol helper, then runs the
 * server smoke pinned to that market — it reviews it with the heuristic
 * provider, submits the real `approveMarket` transaction, and asserts the
 * indexed transition to `bootstrap`. Nothing is fabricated in the database;
 * a market must exist on-chain for the approval transaction to succeed.
 */

const LOG_LABEL = "local-ai-review-smoke";

async function main() {
  if (!existsSync(localChainEnvFile)) {
    throw new Error(
      `${localChainEnvFile} not found. Start the stack first: pnpm local:smoke -- --keep-running`,
    );
  }
  const stackEnv = parseEnvFile(readFileSync(localChainEnvFile, "utf8"));

  console.log(`[${LOG_LABEL}] creating a fresh market for review`);
  const marketOutput = await collectCommand(
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    { cwd: repoRoot, env: { ...process.env, ...stackEnv }, rejectOnFailure: true },
  );
  const market = parseSmokeMarket(marketOutput.stdout);
  console.log(
    `[${LOG_LABEL}] created market ${market.marketId} (${market.metadataHash})`,
  );

  await collectCommand("bun", ["run", "smoke:ai-review-runner"], {
    cwd: serverDir,
    env: {
      ...process.env,
      ...stackEnv,
      POPCHARTS_DEVCHAIN_PRIVATE_KEY:
        process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
        stackEnv.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
        DEFAULT_HARDHAT_PRIVATE_KEY,
      POPCHARTS_SMOKE_MARKET_ID: market.marketId,
      POPCHARTS_SMOKE_METADATA_HASH: market.metadataHash,
    },
    echoPrefix: "ai-review-smoke",
    rejectOnFailure: true,
  });
  console.log(`[${LOG_LABEL}] passed`);
}

main().catch((error) => {
  console.error(`[${LOG_LABEL}] failed`, error);
  process.exitCode = 1;
});
