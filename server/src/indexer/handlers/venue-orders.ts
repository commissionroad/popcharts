import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { and, db, eq, schema } from "src/db/client";

type BaseOrderArgs = {
  orderId?: number;
  poolId?: `0x${string}`;
};

type VenueOrderLog<TArgs extends BaseOrderArgs> = Log & {
  args: TArgs;
};

export type OrderCreatedLog = VenueOrderLog<{
  amountIn?: bigint;
  liquidity?: bigint;
  orderId?: number;
  owner?: `0x${string}`;
  poolId?: `0x${string}`;
  tickLower?: number;
  tickUpper?: number;
  zeroForOne?: boolean;
}>;

export type OrderCancelledLog = VenueOrderLog<{
  amount0?: bigint;
  amount1?: bigint;
  orderId?: number;
  owner?: `0x${string}`;
  poolId?: `0x${string}`;
}>;

export type OrderFilledLog = VenueOrderLog<{
  amount0?: bigint;
  amount1?: bigint;
  orderId?: number;
  owner?: `0x${string}`;
  poolId?: `0x${string}`;
}>;

export type OrderPartiallyFilledLog = VenueOrderLog<{
  amount0?: bigint;
  amount1?: bigint;
  indexedTick?: number;
  orderId?: number;
  owner?: `0x${string}`;
  poolId?: `0x${string}`;
  remainingLiquidity?: bigint;
  tickLower?: number;
  tickUpper?: number;
}>;

export type OrderRequeuedLog = VenueOrderLog<{
  orderId?: number;
  poolId?: `0x${string}`;
  thresholdTick?: number;
}>;

export type VenueOrderEventRecord = typeof schema.venueOrderEvents.$inferInsert;

export type OrderCreatedRecord = VenueOrderEventRecord & {
  amountIn: bigint;
  eventType: "created";
  liquidity: bigint;
  owner: string;
  tickLower: number;
  tickUpper: number;
  zeroForOne: boolean;
};
export type OrderCancelledRecord = VenueOrderEventRecord & {
  amount0: bigint;
  amount1: bigint;
  eventType: "cancelled";
  owner: string;
};
export type OrderFilledRecord = VenueOrderEventRecord & {
  amount0: bigint;
  amount1: bigint;
  eventType: "filled";
  owner: string;
};
export type OrderPartiallyFilledRecord = VenueOrderEventRecord & {
  amount0: bigint;
  amount1: bigint;
  eventType: "partially_filled";
  indexedTick: number;
  owner: string;
  remainingLiquidity: bigint;
  tickLower: number;
  tickUpper: number;
};
export type OrderRequeuedRecord = VenueOrderEventRecord & {
  eventType: "requeued";
  indexedTick: number;
};

/**
 * Every projection update on a venue_orders row assumes its OrderCreated
 * event has already been persisted, but each order event runs behind an
 * independent cursor, so a fill or cancellation can be processed first.
 * Handlers throw this instead of silently matching zero rows; watchers wrap
 * persistence in retryUntilVenueOrderIndexed so an unresolved miss keeps the
 * event's block cursor behind and recovery replays it.
 */
export class VenueOrderNotIndexedError extends Error {
  constructor({
    chainId,
    orderId,
    poolId,
  }: {
    chainId: number;
    orderId: number;
    poolId: string;
  }) {
    super(
      `Venue order chainId=${chainId} poolId=${poolId} orderId=${orderId} has no venue_orders row yet; OrderCreated has not been persisted.`,
    );
    this.name = "VenueOrderNotIndexedError";
  }
}

/** Maps an OrderCreated log into a typed venue_order_events row. */
export function buildOrderCreatedRecord(
  input: BuildInput<OrderCreatedLog>,
): OrderCreatedRecord {
  const { log } = input;

  return {
    ...baseEventFields(input),
    amountIn: requireValue(log.args.amountIn, "amountIn"),
    eventType: "created",
    liquidity: requireValue(log.args.liquidity, "liquidity"),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    tickLower: requireValue(log.args.tickLower, "tickLower"),
    tickUpper: requireValue(log.args.tickUpper, "tickUpper"),
    zeroForOne: requireValue(log.args.zeroForOne, "zeroForOne"),
  };
}

/** Maps an OrderCancelled log into a typed venue_order_events row. */
export function buildOrderCancelledRecord(
  input: BuildInput<OrderCancelledLog>,
): OrderCancelledRecord {
  const { log } = input;

  return {
    ...baseEventFields(input),
    amount0: requireValue(log.args.amount0, "amount0"),
    amount1: requireValue(log.args.amount1, "amount1"),
    eventType: "cancelled",
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
  };
}

/** Maps an OrderFilled log into a typed venue_order_events row. */
export function buildOrderFilledRecord(
  input: BuildInput<OrderFilledLog>,
): OrderFilledRecord {
  const { log } = input;

  return {
    ...baseEventFields(input),
    amount0: requireValue(log.args.amount0, "amount0"),
    amount1: requireValue(log.args.amount1, "amount1"),
    eventType: "filled",
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
  };
}

/** Maps an OrderPartiallyFilled log into a typed venue_order_events row. */
export function buildOrderPartiallyFilledRecord(
  input: BuildInput<OrderPartiallyFilledLog>,
): OrderPartiallyFilledRecord {
  const { log } = input;

  return {
    ...baseEventFields(input),
    amount0: requireValue(log.args.amount0, "amount0"),
    amount1: requireValue(log.args.amount1, "amount1"),
    eventType: "partially_filled",
    indexedTick: requireValue(log.args.indexedTick, "indexedTick"),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    remainingLiquidity: requireValue(
      log.args.remainingLiquidity,
      "remainingLiquidity",
    ),
    tickLower: requireValue(log.args.tickLower, "tickLower"),
    tickUpper: requireValue(log.args.tickUpper, "tickUpper"),
  };
}

/**
 * Maps an OrderRequeued log into a typed venue_order_events row. The event's
 * thresholdTick is where the order is indexed for execution again, so it is
 * stored in the shared indexedTick column.
 */
export function buildOrderRequeuedRecord(
  input: BuildInput<OrderRequeuedLog>,
): OrderRequeuedRecord {
  const { log } = input;

  return {
    ...baseEventFields(input),
    eventType: "requeued",
    indexedTick: requireValue(log.args.thresholdTick, "thresholdTick"),
  };
}

/**
 * Inserts the OrderCreated event and opens its venue_orders projection row.
 * Replayed logs dedup on the event insert, and the projection insert ignores
 * an already-open row, so double delivery cannot corrupt state.
 */
export async function persistOrderCreatedRecord(
  record: OrderCreatedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.venueOrderEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.venueOrderEvents.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .insert(schema.venueOrders)
      .values({
        amountIn: record.amountIn,
        chainId: record.chainId,
        createdBlockNumber: record.blockNumber,
        createdBlockTimestamp: record.blockTimestamp,
        createdLogIndex: record.logIndex,
        createdTransactionHash: record.transactionHash,
        filledAmount0: 0n,
        filledAmount1: 0n,
        liquidity: record.liquidity,
        orderId: record.orderId,
        owner: record.owner,
        poolId: record.poolId,
        remainingLiquidity: record.liquidity,
        status: "open",
        tickLower: record.tickLower,
        tickUpper: record.tickUpper,
        updatedBlockNumber: record.blockNumber,
        updatedLogIndex: record.logIndex,
        zeroForOne: record.zeroForOne,
      })
      .onConflictDoNothing();
  });
}

/**
 * Marks the order cancelled with no remaining liquidity. The returned
 * inventory amounts stay in the event log; they are not maker fills.
 */
export async function persistOrderCancelledRecord(
  record: OrderCancelledRecord,
  dbc: typeof db = db,
) {
  await applyVenueOrderEvent({
    changes: (row, isNewer) =>
      isNewer ? { remainingLiquidity: 0n, status: "cancelled" } : {},
    dbc,
    record,
  });
}

/**
 * Marks the order filled and accumulates the maker payout. The fill amounts
 * are applied for every fresh event regardless of arrival order; the terminal
 * status only when this event is the newest seen for the order.
 */
export async function persistOrderFilledRecord(
  record: OrderFilledRecord,
  dbc: typeof db = db,
) {
  await applyVenueOrderEvent({
    changes: (row, isNewer) => ({
      filledAmount0: row.filledAmount0 + record.amount0,
      filledAmount1: row.filledAmount1 + record.amount1,
      ...(isNewer ? { remainingLiquidity: 0n, status: "filled" } : {}),
    }),
    dbc,
    record,
  });
}

/**
 * Accumulates a partial fill and moves the order to its reindexed range. A
 * partial execution that empties the range deletes the order on-chain, so
 * remainingLiquidity of zero is terminal and marks the order filled.
 */
export async function persistOrderPartiallyFilledRecord(
  record: OrderPartiallyFilledRecord,
  dbc: typeof db = db,
) {
  await applyVenueOrderEvent({
    changes: (row, isNewer) => ({
      // Only partial-fill-enabled orders can emit this event.
      enablePartialFill: true,
      filledAmount0: row.filledAmount0 + record.amount0,
      filledAmount1: row.filledAmount1 + record.amount1,
      ...(isNewer
        ? {
            indexedTick: record.indexedTick,
            remainingLiquidity: record.remainingLiquidity,
            status: record.remainingLiquidity === 0n ? "filled" : row.status,
            tickLower: record.tickLower,
            tickUpper: record.tickUpper,
          }
        : {}),
    }),
    dbc,
    record,
  });
}

/** Updates where the order is indexed for execution after a requeue. */
export async function persistOrderRequeuedRecord(
  record: OrderRequeuedRecord,
  dbc: typeof db = db,
) {
  await applyVenueOrderEvent({
    changes: (row, isNewer) =>
      isNewer ? { indexedTick: record.indexedTick } : {},
    dbc,
    record,
  });
}

type BuildInput<TLog> = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: TLog;
};

type VenueOrderRow = typeof schema.venueOrders.$inferSelect;
type VenueOrderChanges = Partial<typeof schema.venueOrders.$inferInsert>;

/**
 * Shared projection step for post-creation order events: dedup the event row,
 * lock the order row, and apply the caller's changes. `isNewer` compares the
 * event's (block, log index) against the newest event already applied, so
 * cross-cursor races replay increments exactly once and can never regress
 * last-writer-wins state fields.
 */
async function applyVenueOrderEvent({
  changes,
  dbc,
  record,
}: {
  changes: (row: VenueOrderRow, isNewer: boolean) => VenueOrderChanges;
  dbc: typeof db;
  record: VenueOrderEventRecord;
}) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.venueOrderEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.venueOrderEvents.id });

    if (!inserted[0]) {
      return;
    }

    const rows = await tx
      .select()
      .from(schema.venueOrders)
      .where(orderWhere(record))
      .for("update");
    const row = rows[0];

    // Throwing rolls the event insert back too; committing it without the
    // projection would make the dedup skip this event on every future replay.
    if (!row) {
      throw new VenueOrderNotIndexedError(record);
    }

    const isNewer =
      record.blockNumber > row.updatedBlockNumber ||
      (record.blockNumber === row.updatedBlockNumber &&
        record.logIndex > row.updatedLogIndex);

    await tx
      .update(schema.venueOrders)
      .set({
        ...changes(row, isNewer),
        ...(isNewer
          ? {
              updatedBlockNumber: record.blockNumber,
              updatedLogIndex: record.logIndex,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(orderWhere(record));
  });
}

function orderWhere(record: {
  chainId: number;
  orderId: number;
  poolId: string;
}) {
  return and(
    eq(schema.venueOrders.chainId, record.chainId),
    eq(schema.venueOrders.poolId, record.poolId),
    eq(schema.venueOrders.orderId, record.orderId),
  );
}

function baseEventFields<TArgs extends BaseOrderArgs>({
  blockTimestamp,
  config,
  contractId,
  log,
}: BuildInput<VenueOrderLog<TArgs>>) {
  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    logIndex: requireValue(log.logIndex, "logIndex"),
    orderId: requireValue(log.args.orderId, "orderId"),
    poolId: requireValue(log.args.poolId, "poolId").toLowerCase(),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Venue order log is missing ${name}.`);
  }

  return value;
}
