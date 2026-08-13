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
const RATE_ENV = "POPCHARTS_WITHDRAWAL_FEE_RATE_WAD";

/**
 * Arms (or disarms) the pre-graduation withdrawal fee: calls
 * `setWithdrawalFeeRate(rateWad)` on the deployed PregradManager with the
 * owner key (protocol ADR 0014 §3/P4b, docs/fee-model.md). The rate is
 * WAD-scaled — 5e16 is 5% — and zero disarms the fee. The contract's hard cap
 * (`MAX_WITHDRAWAL_FEE_RATE_WAD`, 10%) stays on-chain; this script only
 * surfaces a readable error when the transaction reverts, and reads the rate
 * back so the operator sees what is now armed.
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

  const previousRateWad = (await manager.read.withdrawalFeeRateWad()) as bigint;
  console.log(
    `Setting withdrawal fee rate on ${pregradManagerAddress} (chain ${chainId}): ` +
      `${formatRate(previousRateWad)} -> ${formatRate(rateWad)}`,
  );

  const hash = await manager.write.setWithdrawalFeeRate([rateWad], { account });
  await requireSuccessfulReceipt(publicClient, hash, "setWithdrawalFeeRate");

  const currentRateWad = (await manager.read.withdrawalFeeRateWad()) as bigint;
  console.log(`Withdrawal fee rate is now ${formatRate(currentRateWad)} (tx ${hash}).`);
}

function readRateInput(): string {
  const fromEnv = process.env[RATE_ENV];
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(
    `Set ${RATE_ENV} to the WAD-scaled rate (50000000000000000 is 5%). Zero disarms the fee.`,
  );
}

function parseRateInput(input: string): bigint {
  try {
    return BigInt(input);
  } catch {
    throw new Error(
      `Withdrawal fee rate must be a WAD-scaled integer (got "${input}"); 50000000000000000 is 5%.`,
    );
  }
}

function formatRate(rateWad: bigint): string {
  return `${rateWad} wad (${(Number(rateWad) / 1e16).toFixed(2)}%)`;
}

// The same local resolver set-entry-fee-rate.ts uses (postgrad manifest via
// the deployment-file env override); see the consolidation note there.
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
