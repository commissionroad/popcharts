import { describe, expect, it } from "bun:test";

import { schema } from "src/db/client";

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
} from "./venue-orders";

const blockTimestamp = new Date("2026-07-01T12:00:00.000Z");
const config = { chainId: 5042002 };
const contractId = 9;
const poolId =
  "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const lowercasePoolId = poolId.toLowerCase();

describe("venue order event record builders", () => {
  it("maps an OrderCreated log into a typed record", () => {
    const log = baseLog({
      amountIn: 5_000_000_000_000_000_000n,
      liquidity: 777n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
      tickLower: -120,
      tickUpper: 60,
      zeroForOne: false,
    }) as OrderCreatedLog;

    expect(
      buildOrderCreatedRecord({ blockTimestamp, config, contractId, log }),
    ).toEqual({
      amountIn: 5_000_000_000_000_000_000n,
      blockNumber: 321n,
      blockTimestamp,
      chainId: 5042002,
      contractId,
      eventType: "created",
      liquidity: 777n,
      logIndex: 7,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000aa",
      poolId: lowercasePoolId,
      tickLower: -120,
      tickUpper: 60,
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      zeroForOne: false,
    });
  });

  it("maps cancellation and fill logs", () => {
    const cancelledLog = baseLog({
      amount0: 11n,
      amount1: 0n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
    }) as OrderCancelledLog;
    const filledLog = baseLog({
      amount0: 0n,
      amount1: 42n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
    }) as OrderFilledLog;

    expect(
      buildOrderCancelledRecord({
        blockTimestamp,
        config,
        contractId,
        log: cancelledLog,
      }),
    ).toMatchObject({
      amount0: 11n,
      amount1: 0n,
      eventType: "cancelled",
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000aa",
      poolId: lowercasePoolId,
    });
    expect(
      buildOrderFilledRecord({
        blockTimestamp,
        config,
        contractId,
        log: filledLog,
      }),
    ).toMatchObject({
      amount0: 0n,
      amount1: 42n,
      eventType: "filled",
      orderId: 3,
    });
  });

  it("maps partial-fill and requeue logs, storing the requeue threshold as indexedTick", () => {
    const partialLog = baseLog({
      amount0: 5n,
      amount1: 6n,
      indexedTick: -30,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
      remainingLiquidity: 400n,
      tickLower: -90,
      tickUpper: 30,
    }) as OrderPartiallyFilledLog;
    const requeuedLog = baseLog({
      orderId: 3,
      poolId,
      thresholdTick: 45,
    }) as OrderRequeuedLog;

    expect(
      buildOrderPartiallyFilledRecord({
        blockTimestamp,
        config,
        contractId,
        log: partialLog,
      }),
    ).toMatchObject({
      amount0: 5n,
      amount1: 6n,
      eventType: "partially_filled",
      indexedTick: -30,
      remainingLiquidity: 400n,
      tickLower: -90,
      tickUpper: 30,
    });
    const requeuedRecord = buildOrderRequeuedRecord({
      blockTimestamp,
      config,
      contractId,
      log: requeuedLog,
    });

    expect(requeuedRecord).toMatchObject({
      eventType: "requeued",
      indexedTick: 45,
      orderId: 3,
    });
    expect(requeuedRecord).not.toHaveProperty("owner");
  });

  it("throws when required order log fields are missing", () => {
    const missingLiquidity = baseLog({
      amountIn: 1n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
      tickLower: -120,
      tickUpper: 60,
      zeroForOne: true,
    }) as OrderCreatedLog;
    const missingPool = baseLog({
      orderId: 3,
      thresholdTick: 45,
    }) as OrderRequeuedLog;

    expect(() =>
      buildOrderCreatedRecord({
        blockTimestamp,
        config,
        contractId,
        log: missingLiquidity,
      }),
    ).toThrow("liquidity");
    expect(() =>
      buildOrderRequeuedRecord({
        blockTimestamp,
        config,
        contractId,
        log: missingPool,
      }),
    ).toThrow("poolId");
  });
});

describe("persistOrderCreatedRecord", () => {
  const record = buildOrderCreatedRecord({
    blockTimestamp,
    config,
    contractId,
    log: baseLog({
      amountIn: 5n,
      liquidity: 777n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
      tickLower: -120,
      tickUpper: 60,
      zeroForOne: true,
    }) as OrderCreatedLog,
  });

  it("opens the projection row for a fresh event", async () => {
    const { dbc, orderInserts } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: null,
    });

    await persistOrderCreatedRecord(record, dbc);

    expect(orderInserts()).toHaveLength(1);
    expect(orderInserts()[0]).toMatchObject({
      filledAmount0: 0n,
      filledAmount1: 0n,
      liquidity: 777n,
      orderId: 3,
      remainingLiquidity: 777n,
      status: "open",
      updatedBlockNumber: 321n,
      updatedLogIndex: 7,
    });
  });

  it("skips the projection for a replayed event", async () => {
    const { dbc, orderInserts } = fakeVenueOrderDb({
      insertedRows: [],
      orderRow: null,
    });

    await persistOrderCreatedRecord(record, dbc);

    expect(orderInserts()).toHaveLength(0);
  });
});

describe("post-creation order event persistence", () => {
  const filledRecord = buildOrderFilledRecord({
    blockTimestamp,
    config,
    contractId,
    log: baseLog({
      amount0: 10n,
      amount1: 20n,
      orderId: 3,
      owner: "0x00000000000000000000000000000000000000AA",
      poolId,
    }) as OrderFilledLog,
  });

  it("throws VenueOrderNotIndexedError when the fill lands before OrderCreated", async () => {
    // Rolls back the whole transaction, so the event row is not committed and
    // a later replay is not skipped by the onConflictDoNothing dedup.
    const { dbc } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: null,
    });

    await expect(
      persistOrderFilledRecord(filledRecord, dbc),
    ).rejects.toBeInstanceOf(VenueOrderNotIndexedError);
  });

  it("skips the projection for a replayed event", async () => {
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [],
      orderRow: openOrderRow(),
    });

    await persistOrderFilledRecord(filledRecord, dbc);

    expect(updates()).toHaveLength(0);
  });

  it("marks the order filled and accumulates payouts for a fresh, newest event", async () => {
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow({ filledAmount0: 1n, filledAmount1: 2n }),
    });

    await persistOrderFilledRecord(filledRecord, dbc);

    expect(updates()[0]).toMatchObject({
      filledAmount0: 11n,
      filledAmount1: 22n,
      remainingLiquidity: 0n,
      status: "filled",
      updatedBlockNumber: 321n,
      updatedLogIndex: 7,
    });
  });

  it("applies fill accounting but no state for an out-of-order older event", async () => {
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow({ updatedBlockNumber: 900n }),
    });

    await persistOrderFilledRecord(filledRecord, dbc);

    const applied = updates()[0]!;
    expect(applied).toMatchObject({ filledAmount0: 10n, filledAmount1: 20n });
    expect(applied).not.toHaveProperty("status");
    expect(applied).not.toHaveProperty("updatedBlockNumber");
  });

  it("moves a partially filled order to its reindexed range", async () => {
    const record = buildOrderPartiallyFilledRecord({
      blockTimestamp,
      config,
      contractId,
      log: baseLog({
        amount0: 5n,
        amount1: 6n,
        indexedTick: -30,
        orderId: 3,
        owner: "0x00000000000000000000000000000000000000AA",
        poolId,
        remainingLiquidity: 400n,
        tickLower: -90,
        tickUpper: 30,
      }) as OrderPartiallyFilledLog,
    });
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow(),
    });

    await persistOrderPartiallyFilledRecord(record, dbc);

    expect(updates()[0]).toMatchObject({
      enablePartialFill: true,
      filledAmount0: 5n,
      filledAmount1: 6n,
      indexedTick: -30,
      remainingLiquidity: 400n,
      status: "open",
      tickLower: -90,
      tickUpper: 30,
    });
  });

  it("treats a partial fill that empties the range as terminal", async () => {
    const record = buildOrderPartiallyFilledRecord({
      blockTimestamp,
      config,
      contractId,
      log: baseLog({
        amount0: 5n,
        amount1: 6n,
        indexedTick: -30,
        orderId: 3,
        owner: "0x00000000000000000000000000000000000000AA",
        poolId,
        remainingLiquidity: 0n,
        tickLower: -90,
        tickUpper: 30,
      }) as OrderPartiallyFilledLog,
    });
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow(),
    });

    await persistOrderPartiallyFilledRecord(record, dbc);

    expect(updates()[0]).toMatchObject({
      remainingLiquidity: 0n,
      status: "filled",
    });
  });

  it("marks a cancelled order and returns no liquidity to the book", async () => {
    const record = buildOrderCancelledRecord({
      blockTimestamp,
      config,
      contractId,
      log: baseLog({
        amount0: 11n,
        amount1: 0n,
        orderId: 3,
        owner: "0x00000000000000000000000000000000000000AA",
        poolId,
      }) as OrderCancelledLog,
    });
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow(),
    });

    await persistOrderCancelledRecord(record, dbc);

    expect(updates()[0]).toMatchObject({
      remainingLiquidity: 0n,
      status: "cancelled",
    });
    expect(updates()[0]).not.toHaveProperty("filledAmount0");
  });

  it("updates the execution index tick on requeue", async () => {
    const record = buildOrderRequeuedRecord({
      blockTimestamp,
      config,
      contractId,
      log: baseLog({
        orderId: 3,
        poolId,
        thresholdTick: 45,
      }) as OrderRequeuedLog,
    });
    const { dbc, updates } = fakeVenueOrderDb({
      insertedRows: [{ id: 1 }],
      orderRow: openOrderRow(),
    });

    await persistOrderRequeuedRecord(record, dbc);

    expect(updates()[0]).toMatchObject({
      indexedTick: 45,
      updatedBlockNumber: 321n,
    });
  });
});

function baseLog(args: Record<string, unknown>) {
  return {
    args,
    blockNumber: 321n,
    logIndex: 7,
    transactionHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  };
}

type FakeOrderRow = {
  filledAmount0: bigint;
  filledAmount1: bigint;
  status: "open" | "filled" | "cancelled";
  updatedBlockNumber: bigint;
  updatedLogIndex: number;
};

/** An open venue_orders row older than the test events (block 321). */
function openOrderRow(overrides: Partial<FakeOrderRow> = {}): FakeOrderRow {
  return {
    filledAmount0: 0n,
    filledAmount1: 0n,
    status: "open",
    updatedBlockNumber: 100n,
    updatedLogIndex: 1,
    ...overrides,
  };
}

/**
 * Minimal stand-in for the transactional drizzle handle used by venue order
 * persists: `insertedRows` is what the event insert returns (empty means the
 * dedup conflict fired), `orderRow` is what the locked projection SELECT
 * finds. Captures projection inserts and updates for assertions.
 */
function fakeVenueOrderDb({
  insertedRows,
  orderRow,
}: {
  insertedRows: Array<{ id: number }>;
  orderRow: FakeOrderRow | null;
}) {
  const orderInserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === schema.venueOrderEvents) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => insertedRows,
            }),
          };
        }

        orderInserts.push(values);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => (orderRow ? [orderRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  const dbc = {
    transaction: (callback: (handle: typeof tx) => Promise<void>) =>
      callback(tx),
  } as unknown as Parameters<typeof persistOrderCreatedRecord>[1];

  return {
    dbc,
    orderInserts: () => orderInserts,
    updates: () => updates,
  };
}
