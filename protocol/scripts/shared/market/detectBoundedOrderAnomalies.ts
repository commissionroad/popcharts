/** One flagged problem in a bounded pool's order or configuration state. */
export type BoundedOrderAnomaly = {
  readonly code:
    | "crossedOrderUnfilled"
    | "poolNotWhitelisted"
    | "staleDeferredExecution"
    | "tickBoundsUnset";
  readonly message: string;
  readonly side: "no" | "yes";
};

/** Point-in-time snapshot of one bounded outcome pool for anomaly detection. */
export type BoundedPoolInspection = {
  readonly boundsConfigured: boolean;
  readonly currentTick: number;
  readonly deferredExecutions: readonly {
    readonly executionId: string;
    readonly remainingOrderCount: bigint;
    readonly storedAtBlock: bigint;
  }[];
  readonly orders: readonly {
    readonly createdAtBlock: bigint;
    readonly orderId: number;
    readonly tickLower: number;
    readonly tickUpper: number;
    readonly zeroForOne: boolean;
  }[];
  readonly side: "no" | "yes";
  readonly whitelisted: boolean;
};

/**
 * Flags stuck-order and misconfiguration anomalies in bounded pools: open
 * orders whose full-fill threshold the pool tick has already crossed but that
 * stayed unfilled for at least the staleness window, pending deferred
 * executions older than their window, unset tick bounds, and non-whitelisted
 * pools. A crossed order is one the current tick sits fully past (above
 * `tickUpper` for a currency0 seller, below `tickLower` for a currency1
 * seller); order age is measured from its creation block because crossing
 * blocks are not observable from current state alone.
 */
export function detectBoundedOrderAnomalies(args: {
  readonly currentBlock: bigint;
  readonly pools: readonly BoundedPoolInspection[];
  readonly staleCrossedOrderBlocks: number;
  readonly staleDeferredExecutionBlocks: number;
}): BoundedOrderAnomaly[] {
  requireStaleBlocks(args.staleCrossedOrderBlocks, "staleCrossedOrderBlocks");
  requireStaleBlocks(args.staleDeferredExecutionBlocks, "staleDeferredExecutionBlocks");
  if (args.currentBlock < 0n) {
    throw new Error(`Expected a non-negative currentBlock, received ${args.currentBlock}.`);
  }

  const anomalies: BoundedOrderAnomaly[] = [];
  for (const pool of args.pools) {
    const label = pool.side.toUpperCase();
    if (!pool.boundsConfigured) {
      anomalies.push({
        code: "tickBoundsUnset",
        message: `${label} pool has no configured tick bounds; hooked swaps will revert.`,
        side: pool.side,
      });
    }
    if (!pool.whitelisted) {
      anomalies.push({
        code: "poolNotWhitelisted",
        message: `${label} pool is not whitelisted in the order manager; maker orders are blocked.`,
        side: pool.side,
      });
    }

    for (const order of pool.orders) {
      const age = blockAge(args.currentBlock, order.createdAtBlock, "order creation block");
      const crossed = order.zeroForOne
        ? pool.currentTick > order.tickUpper
        : pool.currentTick < order.tickLower;
      if (crossed && age >= BigInt(args.staleCrossedOrderBlocks)) {
        anomalies.push({
          code: "crossedOrderUnfilled",
          message:
            `${label} pool order #${order.orderId} range [${order.tickLower}, ` +
            `${order.tickUpper}] is crossed by tick ${pool.currentTick} but still open ` +
            `after ${age} blocks.`,
          side: pool.side,
        });
      }
    }

    for (const execution of pool.deferredExecutions) {
      const age = blockAge(args.currentBlock, execution.storedAtBlock, "deferred storage block");
      if (age >= BigInt(args.staleDeferredExecutionBlocks)) {
        anomalies.push({
          code: "staleDeferredExecution",
          message:
            `${label} pool deferred execution ${execution.executionId} has been pending ` +
            `for ${age} blocks (${execution.remainingOrderCount} orders remaining); ` +
            "drain it with the keeper or resolveDeferredExecution.",
          side: pool.side,
        });
      }
    }
  }
  return anomalies;
}

function blockAge(currentBlock: bigint, eventBlock: bigint, label: string): bigint {
  if (eventBlock > currentBlock) {
    throw new Error(`Expected ${label} ${eventBlock} to be at or before block ${currentBlock}.`);
  }
  return currentBlock - eventBlock;
}

function requireStaleBlocks(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Expected ${label} to be a positive integer, received ${value}.`);
  }
}
