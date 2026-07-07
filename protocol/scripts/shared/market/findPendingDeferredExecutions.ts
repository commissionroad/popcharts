import type { Address, Hex, PublicClient } from "viem";

import { boundedPoolOrderManagerAbi } from "../../../src/generated/postgrad-venue.js";

/** One deferred crossed-order batch still awaiting resolver work. */
export type PendingDeferredExecution = {
  readonly executionId: Hex;
  readonly fromTick: number;
  readonly orderCount: bigint;
  readonly poolId: Hex;
  readonly remainingOrderCount: bigint;
  readonly storedAtBlock: bigint;
  readonly toTick: number;
};

/**
 * Discovers deferred executions that still need resolver work by replaying
 * DeferredExecutionStored events since `fromBlock` and keeping only IDs whose
 * getDeferredExecution state is still pending, optionally filtered to the
 * pools of one market so a keeper never drains another market's batches.
 */
export async function findPendingDeferredExecutions(args: {
  readonly fromBlock: bigint;
  readonly orderManager: Address;
  readonly poolIds?: readonly Hex[];
  readonly publicClient: PublicClient;
}): Promise<PendingDeferredExecution[]> {
  if (args.fromBlock < 0n) {
    throw new Error(`Expected a non-negative fromBlock, received ${args.fromBlock}.`);
  }

  const logs = await args.publicClient.getContractEvents({
    abi: boundedPoolOrderManagerAbi,
    address: args.orderManager,
    eventName: "DeferredExecutionStored",
    fromBlock: args.fromBlock,
    strict: true,
    toBlock: "latest",
  });
  const poolFilter =
    args.poolIds === undefined
      ? undefined
      : new Set(args.poolIds.map((poolId) => poolId.toLowerCase()));

  const pending: PendingDeferredExecution[] = [];
  const seen = new Set<Hex>();
  for (const log of logs) {
    const { executionId, poolId } = log.args;
    if (seen.has(executionId) || log.blockNumber === null) {
      continue;
    }
    seen.add(executionId);
    if (poolFilter !== undefined && !poolFilter.has(poolId.toLowerCase())) {
      continue;
    }

    // Re-read live state: the batch may already be partially or fully drained
    // since the event fired, and the read carries the fresh remaining count.
    const [isPending, , fromTick, toTick, , , orderCount, remainingOrderCount] =
      await args.publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: args.orderManager,
        args: [executionId],
        functionName: "getDeferredExecution",
      });
    if (!isPending) {
      continue;
    }
    pending.push({
      executionId,
      fromTick,
      orderCount,
      poolId,
      remainingOrderCount,
      storedAtBlock: log.blockNumber,
      toTick,
    });
  }
  return pending;
}
