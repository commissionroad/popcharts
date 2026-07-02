import type { Address, Hex, PublicClient } from "viem";

const DEFERRED_EXECUTION_STORED_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "executionId", type: "bytes32" },
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: false, name: "fromTick", type: "int24" },
      { indexed: false, name: "toTick", type: "int24" },
      { indexed: false, name: "orderCount", type: "uint256" },
    ],
    name: "DeferredExecutionStored",
    type: "event",
  },
] as const;

const GET_DEFERRED_EXECUTION_ABI = [
  {
    inputs: [{ name: "executionId", type: "bytes32" }],
    name: "getDeferredExecution",
    outputs: [
      { name: "pending", type: "bool" },
      { name: "poolId", type: "bytes32" },
      { name: "fromTick", type: "int24" },
      { name: "toTick", type: "int24" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "nextOrderIndex", type: "uint256" },
      { name: "orderCount", type: "uint256" },
      { name: "remainingOrderCount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

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
    abi: DEFERRED_EXECUTION_STORED_EVENT_ABI,
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
        abi: GET_DEFERRED_EXECUTION_ABI,
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
