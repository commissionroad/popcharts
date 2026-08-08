import hre, { network } from "hardhat";
import type { Address } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { runScript } from "./shared/cli/runScript.js";
import { readManifestAddresses } from "./shared/deployment/readManifestAddresses.js";
import { resolveDeploymentManifestFile } from "./shared/deployment/resolveDeploymentManifestFile.js";
import { POSTGRAD_VENUE_DEPLOYMENT } from "#src/deployment/postgradVenueDeployment.js";
import { requireSuccessfulReceipt } from "#src/viem/requireSuccessfulReceipt.js";

// The env var carrying the rate. Env-only on purpose: `hardhat run` keeps its
// own arguments (e.g. the network name) in argv, so a trailing-argument path
// would read "localhost" as a rate.
const RATE_ENV = "POPCHARTS_ENTRY_FEE_RATE_WAD";

/**
 * Arms (or disarms) the pre-graduation entry fee: calls
 * `setEntryFeeRate(rateWad)` on the deployed PregradManager with the owner
 * key (protocol ADR 0014 §3, docs/fee-model.md). The rate is WAD-scaled —
 * 1e16 is 1% — and zero disarms the fee. The contract's hard cap
 * (`MAX_ENTRY_FEE_RATE_WAD`, 10%) stays on-chain; this script only surfaces
 * a readable error when the transaction reverts, and reads the rate back so
 * the operator sees what is now armed.
 */
async function main(): Promise<void> {
  const { account, chainId, connection, profile, publicClient } =
    await initializeWalletScriptEnvironment({ accountRole: "operator", network });

  const rateWad = parseRateInput(readRateInput());

  const pregradManagerAddress = await resolvePregradManagerAddress({
    chainEnv: profile.chainEnv,
    chainId,
    env: process.env,
    protocolRoot: hre.config.paths.root,
  });
  const manager = await connection.viem.getContractAt("PregradManager", pregradManagerAddress);

  const previousRateWad = (await manager.read.entryFeeRateWad()) as bigint;
  console.log(
    `Setting entry fee rate on ${pregradManagerAddress} (chain ${chainId}): ` +
      `${formatRate(previousRateWad)} -> ${formatRate(rateWad)}`,
  );

  const hash = await manager.write.setEntryFeeRate([rateWad], { account });
  await requireSuccessfulReceipt(publicClient, hash, "setEntryFeeRate");

  const currentRateWad = (await manager.read.entryFeeRateWad()) as bigint;
  console.log(`Entry fee rate is now ${formatRate(currentRateWad)} (tx ${hash}).`);
}

function readRateInput(): string {
  const fromEnv = process.env[RATE_ENV];
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    `Set ${RATE_ENV} to the WAD-scaled rate (10000000000000000 is 1%). Zero disarms the fee.`,
  );
}

function parseRateInput(input: string): bigint {
  try {
    return BigInt(input);
  } catch {
    throw new Error(
      `Entry fee rate must be a WAD-scaled integer (got "${input}"); 10000000000000000 is 1%.`,
    );
  }
}

function formatRate(rateWad: bigint): string {
  return `${rateWad} wad (${(Number(rateWad) / 1e16).toFixed(2)}%)`;
}

// The same local resolver cancel-market.ts uses (postgrad manifest via the
// deployment-file env override). deploy-complete-set-postgrad.ts carries a
// different one — protocol manifest, address override, bytecode assert — so
// consolidating the two is a behaviour decision, deliberately not made here.
async function resolvePregradManagerAddress(args: {
  readonly chainEnv: string;
  readonly chainId: number;
  readonly env: NodeJS.ProcessEnv;
  readonly protocolRoot: string;
}): Promise<Address> {
  const { pregradManager } = await readManifestAddresses({
    deployHint: POSTGRAD_VENUE_DEPLOYMENT.deployHint,
    expectedChainId: args.chainId,
    kind: "postgrad",
    manifestFile: resolveDeploymentManifestFile(POSTGRAD_VENUE_DEPLOYMENT, args),
    names: ["pregradManager"],
    protocolRoot: args.protocolRoot,
  });
  return pregradManager;
}

await runScript(main);
