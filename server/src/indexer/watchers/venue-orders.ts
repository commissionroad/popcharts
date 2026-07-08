import { parseAbiItem, type AbiEvent } from "viem";

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
import {
  getRecoveryStartBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import { retryUntilIndexed } from "src/indexer/utils/retry-until-indexed";
import { ensureVenuePoolIndexed } from "src/indexer/utils/venue-pool-registry";

/**
 * Watches the BoundedPoolOrderManager's maker-order lifecycle so the server
 * can serve an order book and per-user open orders for graduated markets.
 * DeferredExecutionStored/Resolved are deliberately not indexed: the keeper
 * consumes them on-chain, and deferred orders emit OrderFilled /
 * OrderPartiallyFilled only when actually executed, so the projection stays
 * consistent without them.
 */

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

type RecoveryOptions = {
  quiet?: boolean;
};

type VenueOrderEventDefinition<TLog> = {
  cursorName: string;
  event: AbiEvent;
  eventName:
    | "OrderCreated"
    | "OrderCancelled"
    | "OrderFilled"
    | "OrderPartiallyFilled"
    | "OrderRequeued";
  label: string;
  process: (client: BlockchainClient, log: TLog) => Promise<void>;
};

// OrderCreated recovers first so the projection rows exist before the other
// event types' recovery passes need them.
const VENUE_ORDER_EVENTS = [
  {
    cursorName: "OrderCreated",
    event: ORDER_CREATED_EVENT as AbiEvent,
    eventName: "OrderCreated",
    label: "OrderCreated",
    process: processOrderCreatedEvent,
  },
  {
    cursorName: "OrderCancelled",
    event: ORDER_CANCELLED_EVENT as AbiEvent,
    eventName: "OrderCancelled",
    label: "OrderCancelled",
    process: processOrderCancelledEvent,
  },
  {
    cursorName: "OrderFilled",
    event: ORDER_FILLED_EVENT as AbiEvent,
    eventName: "OrderFilled",
    label: "OrderFilled",
    process: processOrderFilledEvent,
  },
  {
    cursorName: "OrderPartiallyFilled",
    event: ORDER_PARTIALLY_FILLED_EVENT as AbiEvent,
    eventName: "OrderPartiallyFilled",
    label: "OrderPartiallyFilled",
    process: processOrderPartiallyFilledEvent,
  },
  {
    cursorName: "OrderRequeued",
    event: ORDER_REQUEUED_EVENT as AbiEvent,
    eventName: "OrderRequeued",
    label: "OrderRequeued",
    process: processOrderRequeuedEvent,
  },
] as const;

export async function processOrderCreatedEvent(
  client: BlockchainClient,
  log: OrderCreatedLog,
) {
  logOrderEvent("OrderCreated", log);
  await ensurePoolMappingIndexed(client, log.args.poolId);

  const record = buildOrderCreatedRecord(await buildInput(client, log));

  await persistOrderCreatedRecord(record);
  await advanceCursor("OrderCreated", record.blockNumber);
}

export async function processOrderCancelledEvent(
  client: BlockchainClient,
  log: OrderCancelledLog,
) {
  logOrderEvent("OrderCancelled", log);
  await ensurePoolMappingIndexed(client, log.args.poolId);

  const record = buildOrderCancelledRecord(await buildInput(client, log));

  await retryUntilOrderIndexed(
    () => persistOrderCancelledRecord(record),
    "OrderCancelled",
  );
  await advanceCursor("OrderCancelled", record.blockNumber);
}

export async function processOrderFilledEvent(
  client: BlockchainClient,
  log: OrderFilledLog,
) {
  logOrderEvent("OrderFilled", log);
  await ensurePoolMappingIndexed(client, log.args.poolId);

  const record = buildOrderFilledRecord(await buildInput(client, log));

  await retryUntilOrderIndexed(
    () => persistOrderFilledRecord(record),
    "OrderFilled",
  );
  await advanceCursor("OrderFilled", record.blockNumber);
}

export async function processOrderPartiallyFilledEvent(
  client: BlockchainClient,
  log: OrderPartiallyFilledLog,
) {
  logOrderEvent("OrderPartiallyFilled", log);
  await ensurePoolMappingIndexed(client, log.args.poolId);

  const record = buildOrderPartiallyFilledRecord(await buildInput(client, log));

  await retryUntilOrderIndexed(
    () => persistOrderPartiallyFilledRecord(record),
    "OrderPartiallyFilled",
  );
  await advanceCursor("OrderPartiallyFilled", record.blockNumber);
}

export async function processOrderRequeuedEvent(
  client: BlockchainClient,
  log: OrderRequeuedLog,
) {
  logOrderEvent("OrderRequeued", log);
  await ensurePoolMappingIndexed(client, log.args.poolId);

  const record = buildOrderRequeuedRecord(await buildInput(client, log));

  await retryUntilOrderIndexed(
    () => persistOrderRequeuedRecord(record),
    "OrderRequeued",
  );
  await advanceCursor("OrderRequeued", record.blockNumber);
}

export async function recoverVenueOrderEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  if (!venueOrderIndexingConfigured()) {
    if (!options.quiet) {
      console.log("[VenueOrders] Order manager not configured; skipping");
    }
    return;
  }

  for (const definition of VENUE_ORDER_EVENTS) {
    await recoverVenueOrderEvent(client, currentBlock, definition, options);
  }
}

export function watchVenueOrderEvents(client: BlockchainClient) {
  if (!venueOrderIndexingConfigured()) {
    console.log("[VenueOrders] Order manager not configured; skipping");
    return () => {};
  }

  console.log("[VenueOrders] Starting real-time event watchers");

  const unwatchers = VENUE_ORDER_EVENTS.map((definition) =>
    client.watchContractEvent({
      abi: [definition.event],
      address: config.contracts.orderManager,
      eventName: definition.eventName,
      onError: (error) => {
        console.error(`[${definition.label}] Watch error:`, error);
      },
      onLogs: async (logs) => {
        for (const log of logs) {
          await definition.process(client, log as never);
        }
      },
    }),
  );

  return () => {
    for (const unwatch of unwatchers) {
      unwatch();
    }
  };
}

async function recoverVenueOrderEvent<TLog>(
  client: BlockchainClient,
  currentBlock: bigint,
  definition: VenueOrderEventDefinition<TLog>,
  options: RecoveryOptions,
) {
  const fromBlock = await getRecoveryStartBlock(
    config.contracts.orderManager,
    definition.cursorName,
    currentBlock,
  );

  if (fromBlock >= currentBlock) {
    if (!options.quiet) {
      console.log(`[${definition.label}] No blocks to recover`);
    }
    return;
  }

  if (!options.quiet) {
    console.log(
      `[${definition.label}] Recovering events from block ${fromBlock} to ${currentBlock}`,
    );
  }

  const logs = await client.getLogs({
    address: config.contracts.orderManager,
    event: definition.event,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log(`[${definition.label}] Found 0 historical events`);
    }
    await updateLastProcessedBlock(
      config.contracts.orderManager,
      definition.cursorName,
      currentBlock,
    );
    return;
  }

  console.log(`[${definition.label}] Found ${logs.length} historical events`);

  for (const log of logs) {
    await definition.process(client, log as TLog);
  }
}

function venueOrderIndexingConfigured() {
  return config.contracts.orderManager !== ZERO_ADDRESS;
}

function advanceCursor(cursorName: string, blockNumber: bigint) {
  return updateLastProcessedBlock(
    config.contracts.orderManager,
    cursorName,
    blockNumber,
  );
}

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
 * event (each event type runs behind an independent cursor); wait for the
 * venue_orders row rather than losing the update. If retries run out, the
 * thrown error keeps the cursor behind so recovery replays the event.
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
 * still-unknown pools; a failure here must never block order indexing or the
 * event's cursor.
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

function logOrderEvent(
  label: string,
  log: { args: { orderId?: number; poolId?: `0x${string}` } },
) {
  const poolId = log.args.poolId ?? "unknown";
  const orderId = log.args.orderId?.toString() ?? "unknown";
  console.log(`[${label}] poolId=${poolId} orderId=${orderId}`);
}
