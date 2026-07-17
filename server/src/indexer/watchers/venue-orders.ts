import { parseAbiItem } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";
import {
  buildOrderCancelledRecord,
  buildOrderCreatedRecord,
  buildOrderFilledRecord,
  buildOrderPartiallyFilledRecord,
  buildOrderRequeuedRecord,
  persistOrderCancelledRecord,
  persistOrderCreatedRecord,
  persistOrderFilledRecord,
  persistOrderPartiallyFilledRecord,
  persistOrderRequeuedRecord,
  VenueOrderNotIndexedError,
  type OrderCancelledLog,
  type OrderCreatedLog,
  type OrderFilledLog,
  type OrderPartiallyFilledLog,
  type OrderRequeuedLog,
} from "src/indexer/handlers/venue-orders";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import { retryUntilIndexed } from "src/indexer/utils/retry-until-indexed";
import { ensureVenuePoolIndexed } from "src/indexer/utils/venue-pool-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
  type DynamicWatcherLog,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches the BoundedPoolOrderManager's maker-order lifecycle so the server
 * can serve an order book and per-user open orders for graduated markets.
 * DeferredExecutionStored/Resolved are deliberately not indexed: the keeper
 * consumes them on-chain, and deferred orders emit OrderFilled /
 * OrderPartiallyFilled only when actually executed, so the projection stays
 * consistent without them.
 */

// One cursor for all order events, replacing the pre-watermark per-event
// cursors (OrderCreated … OrderRequeued); their rows are orphaned and the
// first sweep re-walks from the deploy-block heuristic, which the deduped
// persists absorb. Single-cursor processing delivers events in true chain
// order, so an order's OrderCreated always lands before its fills — the
// retry below then only covers live-vs-sweep races.
const CURSOR_NAME = "VenueOrders";

const ORDER_CREATED_EVENT = parseAbiItem(
  "event OrderCreated(bytes32 indexed poolId, uint32 indexed orderId, address indexed owner, bool zeroForOne, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 amountIn)",
);
const ORDER_CANCELLED_EVENT = parseAbiItem(
  "event OrderCancelled(bytes32 indexed poolId, uint32 indexed orderId, address indexed owner, uint256 amount0, uint256 amount1)",
);
const ORDER_FILLED_EVENT = parseAbiItem(
  "event OrderFilled(bytes32 indexed poolId, uint32 indexed orderId, address indexed owner, uint256 amount0, uint256 amount1)",
);
const ORDER_PARTIALLY_FILLED_EVENT = parseAbiItem(
  "event OrderPartiallyFilled(bytes32 indexed poolId, uint32 indexed orderId, address indexed owner, uint256 amount0, uint256 amount1, int24 tickLower, int24 tickUpper, int24 indexedTick, uint128 remainingLiquidity)",
);
const ORDER_REQUEUED_EVENT = parseAbiItem(
  "event OrderRequeued(bytes32 indexed poolId, uint32 indexed orderId, int24 thresholdTick)",
);

const ORDER_HANDLERS: Record<
  string,
  (client: BlockchainClient, log: DynamicWatcherLog) => Promise<void>
> = {
  OrderCancelled: async (client, log) =>
    retryUntilOrderIndexed(
      async () =>
        persistOrderCancelledRecord(
          buildOrderCancelledRecord(
            await buildInput(client, log as OrderCancelledLog),
          ),
        ),
      "OrderCancelled",
    ),
  OrderCreated: async (client, log) =>
    persistOrderCreatedRecord(
      buildOrderCreatedRecord(await buildInput(client, log as OrderCreatedLog)),
    ),
  OrderFilled: async (client, log) =>
    retryUntilOrderIndexed(
      async () =>
        persistOrderFilledRecord(
          buildOrderFilledRecord(
            await buildInput(client, log as OrderFilledLog),
          ),
        ),
      "OrderFilled",
    ),
  OrderPartiallyFilled: async (client, log) =>
    retryUntilOrderIndexed(
      async () =>
        persistOrderPartiallyFilledRecord(
          buildOrderPartiallyFilledRecord(
            await buildInput(client, log as OrderPartiallyFilledLog),
          ),
        ),
      "OrderPartiallyFilled",
    ),
  OrderRequeued: async (client, log) =>
    retryUntilOrderIndexed(
      async () =>
        persistOrderRequeuedRecord(
          buildOrderRequeuedRecord(
            await buildInput(client, log as OrderRequeuedLog),
          ),
        ),
      "OrderRequeued",
    ),
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [
    ORDER_CREATED_EVENT,
    ORDER_CANCELLED_EVENT,
    ORDER_FILLED_EVENT,
    ORDER_PARTIALLY_FILLED_EVENT,
    ORDER_REQUEUED_EVENT,
  ],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const handle = log.eventName ? ORDER_HANDLERS[log.eventName] : undefined;

    if (!handle) {
      console.warn(
        `[VenueOrders] Unrecognized event ${log.eventName ?? "unknown"}; skipping`,
      );
      return;
    }

    const orderLog = log as DynamicWatcherLog & {
      args: { orderId?: number; poolId?: `0x${string}` };
    };
    console.log(
      `[${log.eventName}] poolId=${orderLog.args.poolId ?? "unknown"} orderId=${orderLog.args.orderId?.toString() ?? "unknown"}`,
    );

    await ensurePoolMappingIndexed(client, orderLog.args.poolId);
    await handle(client, log);
  },
  label: "VenueOrders",
  subject: "order manager",
  // The order manager address is unset until the venue deploys on a chain.
  ...staticContractSet(() =>
    config.contracts.orderManager === ZERO_ADDRESS
      ? null
      : config.contracts.orderManager,
  ),
});

export const recoverVenueOrderEvents = watcher.recover;
export const watchVenueOrderEvents = watcher.watch;

async function buildInput<TLog extends { blockNumber: bigint | null }>(
  client: BlockchainClient,
  log: TLog,
) {
  const contractId = await getOrCreateContractId(
    config.contracts.orderManager,
    "BoundedPoolOrderManager",
  );
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);

  return { blockTimestamp, config, contractId, log };
}

/**
 * A fill, cancellation, or requeue can race ahead of its own OrderCreated
 * event when the live subscription delivers it while the sweep is still
 * backfilling the creation; wait for the venue_orders row rather than losing
 * the update. If retries run out, the thrown error parks the sweep so the
 * event replays.
 */
function retryUntilOrderIndexed<T>(operation: () => Promise<T>, label: string) {
  return retryUntilIndexed(operation, {
    isRetryable: (error) => error instanceof VenueOrderNotIndexedError,
    label,
    waitingFor: "OrderCreated",
  });
}

/**
 * The mapping is a best-effort enrichment re-attempted on every event for
 * still-unknown pools; a failure here must never block order indexing or park
 * the sweep.
 */
async function ensurePoolMappingIndexed(
  client: BlockchainClient,
  poolId: `0x${string}` | undefined,
) {
  if (!poolId) {
    return;
  }

  try {
    await ensureVenuePoolIndexed(client, poolId);
  } catch (error) {
    console.warn(
      `[VenuePools] Mapping registration failed for pool ${poolId}:`,
      error,
    );
  }
}
