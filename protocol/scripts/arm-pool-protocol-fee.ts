import hre, { network } from "hardhat";
import type { Address, Hex, PublicClient } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { runScript } from "./shared/cli/runScript.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { readCompleteSetMarketManifest } from "#src/market/readCompleteSetMarketManifest.js";
import { stateViewAbi } from "#src/generated/third-party/venue.js";
import { requireSuccessfulReceipt } from "#src/viem/requireSuccessfulReceipt.js";

// The env var carrying the packed fee. Env-only on purpose: `hardhat run`
// keeps its own arguments (e.g. the network name) in argv, so a
// trailing-argument path would read "localhost" as a fee.
const FEE_ENV = "POPCHARTS_POOL_PROTOCOL_FEE";

const MAX_PACKED_FEE = (1n << 24n) - 1n;

/**
 * Arms (or re-arms) the post-graduation protocol fee on one market's YES and
 * NO pools: calls `armPoolProtocolFeeBatch(poolKeys, fee)` on the deployed
 * PostgradFeeController with the owner key (protocol ADR 0014 P7,
 * docs/fee-model.md). The fee is the venue's packed uint24 — two 12-bit
 * directions, each capped on-chain at 1000 pips (0.1%) — and zero disarms
 * both directions. When POPCHARTS_POOL_PROTOCOL_FEE is unset, the
 * controller's own SYMMETRIC_PROTOCOL_FEE (0.1% both ways) is armed. The
 * script reads both pools' fees back so the operator sees what is now armed.
 */
async function main(): Promise<void> {
  const { account, chainId, connection, profile, publicClient } =
    await initializeWalletScriptEnvironment({ accountRole: "operator", network });

  const { manifest, manifestPath } = await readCompleteSetMarketManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });
  const feeControllerAddress = await readVenueStackAddress({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    name: "feeController",
    protocolRoot: hre.config.paths.root,
  });
  const feeController = await connection.viem.getContractAt(
    "PostgradFeeController",
    feeControllerAddress,
  );

  const fee =
    process.env[FEE_ENV] === undefined || process.env[FEE_ENV] === ""
      ? ((await feeController.read.SYMMETRIC_PROTOCOL_FEE()) as number)
      : parseFeeInput(process.env[FEE_ENV]);

  const pools = [
    { label: "YES", pool: manifest.pools.yes },
    { label: "NO", pool: manifest.pools.no },
  ] as const;
  const previousFees = await Promise.all(
    pools.map(({ pool }) =>
      readPoolProtocolFee(publicClient, manifest.venue.stateView, pool.poolId),
    ),
  );

  console.log(
    `Arming pool protocol fee on ${feeControllerAddress} (chain ${chainId}) ` +
      `for market ${manifest.market.symbol} (${manifestPath}):`,
  );
  for (const [index, { label, pool }] of pools.entries()) {
    console.log(
      `  ${label} pool ${pool.poolId}: ${formatFee(previousFees[index])} -> ${formatFee(fee)}`,
    );
  }

  const hash = await feeController.write.armPoolProtocolFeeBatch(
    [pools.map(({ pool }) => pool.poolKey), fee],
    { account },
  );
  await requireSuccessfulReceipt(publicClient, hash, "armPoolProtocolFeeBatch");

  for (const { label, pool } of pools) {
    const armedFee = await readPoolProtocolFee(publicClient, manifest.venue.stateView, pool.poolId);
    console.log(`${label} pool protocol fee is now ${formatFee(armedFee)} (tx ${hash}).`);
  }
}

function parseFeeInput(input: string): number {
  let fee: bigint;
  try {
    fee = BigInt(input);
  } catch {
    throw new Error(
      `${FEE_ENV} must be a packed uint24 (got "${input}"); ` +
        "4097000 = 1000 | (1000 << 12) is symmetric 0.1%, zero disarms.",
    );
  }
  if (fee < 0n || fee > MAX_PACKED_FEE) {
    throw new Error(`${FEE_ENV} must fit a uint24 (got ${fee}).`);
  }
  return Number(fee);
}

async function readPoolProtocolFee(
  publicClient: PublicClient,
  stateView: Address,
  poolId: Hex,
): Promise<number> {
  const [, , protocolFee] = await publicClient.readContract({
    abi: stateViewAbi,
    address: stateView,
    args: [poolId],
    functionName: "getSlot0",
  });
  return protocolFee;
}

function formatFee(fee: number): string {
  const zeroForOne = fee & 0xfff;
  const oneForZero = fee >> 12;
  return `${fee} (zeroForOne ${zeroForOne} pips, oneForZero ${oneForZero} pips)`;
}

await runScript(main);
