import {
  completeSetBinaryMarketAbi,
  POSTGRAD_MARKET_STATUS,
} from "@popcharts/protocol";
import type { Hash } from "viem";

import type {
  BlockchainClient,
  BlockchainWalletClient,
} from "src/blockchain/client";

import type { TrackedPendingResolutionMarket } from "./discovery";

/**
 * Why a finalize pass wrote nothing. All four are ordinary operation, never
 * errors: the dispute window is public, so the keeper is one of several actors
 * that can move a pending proposal.
 */
export type ResolutionFinalizeSkipReason =
  /** The market settled — a public finalizer beat us, or an operator resolved a dispute. */
  | "already_resolved"
  /** Someone disputed the proposal; a human adjudicates it, the keeper does not. */
  | "disputed"
  /** No live proposal at all (still trading, or cancelled). */
  | "no_pending_proposal"
  /** The proposal is live but still disputable. */
  | "window_open";

export type ResolutionFinalizeOutcome =
  | { kind: "finalized"; transactionHash: Hash }
  | { kind: "skipped"; reason: ResolutionFinalizeSkipReason };

export type ResolutionFinalizeDependencies = {
  getLatestBlockTimestamp: () => Promise<bigint>;
  readDisputeDeadline: (marketAddress: `0x${string}`) => Promise<bigint>;
  readMarketStatus: (marketAddress: `0x${string}`) => Promise<number>;
  submitFinalize: (marketAddress: `0x${string}`) => Promise<Hash>;
  waitForSuccessfulReceipt: (transactionHash: Hash) => Promise<void>;
};

/**
 * One finalize pass for one postgrad market with a resolution proposal on the
 * table: if the dispute window has closed, submit `finalizeResolution()` and
 * settle the market (repo ADR 0024, protocol ADR 0013).
 *
 * The call is permissionless by design — that is the safety valve, so the
 * resolver cannot strand a market by going dark — which means the keeper races
 * every other finalizer, plus any last-second disputer. Losing that race is the
 * mechanism working: every non-`ResolutionPending` status is a quiet skip, and a
 * transaction that fails because the market moved underneath us is re-checked
 * and swallowed rather than surfaced as a keeper error.
 *
 * Time comes from the chain, not the host: the deadline is a block timestamp,
 * and local stacks jump chain time freely. Comparing against the latest block
 * is also conservative in the safe direction — our transaction lands in a later
 * block, so a pass that decides the window is closed cannot be early.
 */
export async function runResolutionFinalizePass({
  clients,
  dependencies,
  market,
}: {
  clients: {
    publicClient: BlockchainClient;
    walletClient: BlockchainWalletClient;
  };
  dependencies?: ResolutionFinalizeDependencies;
  market: TrackedPendingResolutionMarket;
}): Promise<ResolutionFinalizeOutcome> {
  const chain = dependencies ?? createChainDependencies(clients);
  const skipReason = finalizeSkipReasonForStatus(
    await chain.readMarketStatus(market.postgradMarket),
  );

  if (skipReason) {
    return { kind: "skipped", reason: skipReason };
  }

  const [deadline, latestBlockTimestamp] = await Promise.all([
    chain.readDisputeDeadline(market.postgradMarket),
    chain.getLatestBlockTimestamp(),
  ]);

  if (latestBlockTimestamp < deadline) {
    return { kind: "skipped", reason: "window_open" };
  }

  try {
    const transactionHash = await chain.submitFinalize(market.postgradMarket);
    await chain.waitForSuccessfulReceipt(transactionHash);

    return { kind: "finalized", transactionHash };
  } catch (error) {
    const raceReason = finalizeSkipReasonForStatus(
      await chain.readMarketStatus(market.postgradMarket),
    );

    if (raceReason) {
      return { kind: "skipped", reason: raceReason };
    }

    throw error;
  }
}

/**
 * Maps a contract status to the reason a finalize pass should not write, or
 * null when the market has a live proposal the keeper may finalize.
 */
function finalizeSkipReasonForStatus(
  status: number,
): ResolutionFinalizeSkipReason | null {
  switch (status) {
    case POSTGRAD_MARKET_STATUS.resolutionPending:
      return null;
    case POSTGRAD_MARKET_STATUS.resolved:
      return "already_resolved";
    case POSTGRAD_MARKET_STATUS.disputed:
      return "disputed";
    default:
      return "no_pending_proposal";
  }
}

function createChainDependencies(clients: {
  publicClient: BlockchainClient;
  walletClient: BlockchainWalletClient;
}): ResolutionFinalizeDependencies {
  const { publicClient, walletClient } = clients;

  return {
    getLatestBlockTimestamp: async () =>
      (await publicClient.getBlock()).timestamp,
    readDisputeDeadline: async (marketAddress) =>
      await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "disputeDeadline",
      }),
    readMarketStatus: async (marketAddress) =>
      Number(
        await publicClient.readContract({
          abi: completeSetBinaryMarketAbi,
          address: marketAddress,
          functionName: "status",
        }),
      ),
    submitFinalize: async (marketAddress) =>
      await walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: marketAddress,
        functionName: "finalizeResolution",
      }),
    waitForSuccessfulReceipt: async (transactionHash) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: transactionHash,
      });

      if (receipt.status !== "success") {
        throw new Error(
          `finalizeResolution transaction failed: ${transactionHash}`,
        );
      }
    },
  };
}
