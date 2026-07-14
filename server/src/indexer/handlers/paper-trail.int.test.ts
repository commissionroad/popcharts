import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import {
  buildGraduatedReceiptClaimedRecord,
  buildRefundedReceiptClaimedRecord,
  persistGraduatedReceiptClaimedRecord,
  persistRefundedReceiptClaimedRecord,
  type GraduatedReceiptClaimedLog,
  type RefundedReceiptClaimedLog,
} from "src/indexer/handlers/settlement-claims";
import {
  buildClearingRootSubmittedRecord,
  buildGraduationFinalizedRecord,
  buildGraduationStartedRecord,
  persistClearingRootSubmittedRecord,
  persistGraduationFinalizedRecord,
  persistGraduationStartedRecord,
  type ClearingRootSubmittedLog,
  type GraduationFinalizedLog,
  type GraduationStartedLog,
} from "src/indexer/handlers/settlement-graduation";
import {
  buildMarketCancelledRecord,
  buildMarketRefundsAvailableRecord,
  persistMarketCancelledRecord,
  persistMarketRefundsAvailableRecord,
  type MarketCancelledLog,
  type MarketRefundsAvailableLog,
} from "src/indexer/handlers/settlement-refunds";
import { createIntDb, INT_DB_URL } from "src/test-support/int-db";

const CHAIN_ID = 31337;
const BLOCK_TIMESTAMP = new Date("2026-07-14T12:00:00.000Z");
const OWNER_A = "0x00000000000000000000000000000000000000aa";
const OWNER_B = "0x00000000000000000000000000000000000000bb";

const MARKET = {
  graduationStarted: 1n,
  clearingRootSubmitted: 2n,
  graduationFinalized: 3n,
  graduatedReceiptClaimed: 4n,
  refundedReceiptClaimed: 5n,
  refundsAvailable: 6n,
  cancelled: 7n,
} as const;

let dbc: typeof productionDb;
let contractId: number;
let teardown: (() => Promise<void>) | undefined;

describe.skipIf(!INT_DB_URL)("settlement money paper trail", () => {
  beforeAll(async () => {
    ({ dbc, teardown } = await createIntDb());

    [{ id: contractId }] = await dbc
      .insert(schema.contracts)
      .values({
        address: "0x00000000000000000000000000000000000000cc",
        chainId: CHAIN_ID,
        name: "PregradManager",
      })
      .returning({ id: schema.contracts.id });

    await dbc
      .insert(schema.markets)
      .values([
        marketSeed(MARKET.graduationStarted, "bootstrap", 10n),
        marketSeed(MARKET.clearingRootSubmitted, "bootstrap", 20n),
        marketSeed(MARKET.graduationFinalized, "graduating", 500n),
        marketSeed(MARKET.graduatedReceiptClaimed, "graduated", 1_000n),
        marketSeed(MARKET.refundedReceiptClaimed, "refunded", 900n),
        marketSeed(MARKET.refundsAvailable, "bootstrap", 60n),
        marketSeed(MARKET.cancelled, "bootstrap", 70n),
      ]);

    await dbc.insert(schema.receiptPlacedEvents).values([
      receiptSeed({
        cost: 250n,
        marketId: MARKET.graduatedReceiptClaimed,
        owner: OWNER_A,
        receiptId: 401n,
        transactionByte: "a1",
      }),
      receiptSeed({
        cost: 300n,
        marketId: MARKET.refundedReceiptClaimed,
        owner: OWNER_B,
        receiptId: 501n,
        transactionByte: "a2",
      }),
    ]);
  });

  afterAll(async () => {
    await teardown?.();
  });

  describe("persistGraduationStartedRecord", () => {
    it("persists the snapshot once and applies its market projection once", async () => {
      const record = graduationStartedRecord();

      await persistGraduationStartedRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.graduationStartedEvents)
        .where(eventWhere(schema.graduationStartedEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 12n,
        receiptCount: 4n,
        status: "graduating",
        totalEscrowed: 100n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 17n,
      });

      await persistGraduationStartedRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.graduationStartedEvents)
        .where(eventWhere(schema.graduationStartedEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 12n,
        receiptCount: 4n,
        status: "graduating",
        totalEscrowed: 100n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 17n,
      });
    });

    it("rolls back the event when its market projection is missing", async () => {
      const record = graduationStartedRecord({ marketId: 101n, byte: "b1" });

      await expect(
        persistGraduationStartedRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.graduationStartedEvents.id })
        .from(schema.graduationStartedEvents)
        .where(eventWhere(schema.graduationStartedEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistClearingRootSubmittedRecord", () => {
    it("persists the clearing commitment once and projects graduating once", async () => {
      const record = clearingRootSubmittedRecord();

      await persistClearingRootSubmittedRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.clearingRootSubmittedEvents)
        .where(eventWhere(schema.clearingRootSubmittedEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduating",
        totalEscrowed: 20n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistClearingRootSubmittedRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.clearingRootSubmittedEvents)
        .where(eventWhere(schema.clearingRootSubmittedEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduating",
        totalEscrowed: 20n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the event when its market projection is missing", async () => {
      const record = clearingRootSubmittedRecord({
        marketId: 102n,
        byte: "b2",
      });

      await expect(
        persistClearingRootSubmittedRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.clearingRootSubmittedEvents.id })
        .from(schema.clearingRootSubmittedEvents)
        .where(eventWhere(schema.clearingRootSubmittedEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistGraduationFinalizedRecord", () => {
    it("persists the final settlement once and projects the refund escrow once", async () => {
      const record = graduationFinalizedRecord();

      await persistGraduationFinalizedRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.graduationFinalizedEvents)
        .where(eventWhere(schema.graduationFinalizedEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduated",
        totalEscrowed: 90n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistGraduationFinalizedRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.graduationFinalizedEvents)
        .where(eventWhere(schema.graduationFinalizedEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduated",
        totalEscrowed: 90n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the event when its market projection is missing", async () => {
      const record = graduationFinalizedRecord({
        marketId: 103n,
        byte: "b3",
      });

      await expect(
        persistGraduationFinalizedRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.graduationFinalizedEvents.id })
        .from(schema.graduationFinalizedEvents)
        .where(eventWhere(schema.graduationFinalizedEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistGraduatedReceiptClaimedRecord", () => {
    it("persists receipt-linked retained value and subtracts the refund once", async () => {
      const record = graduatedReceiptClaimedRecord();

      await persistGraduatedReceiptClaimedRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.graduatedReceiptClaimedEvents)
        .where(eventWhere(schema.graduatedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(rows[0]).toMatchObject({
        marketId: MARKET.graduatedReceiptClaimed,
        owner: OWNER_A,
        receiptId: 401n,
        refund: 50n,
        retainedCost: 200n,
        retainedShares: 225n,
        side: 0,
      });
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduated",
        totalEscrowed: 950n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistGraduatedReceiptClaimedRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.graduatedReceiptClaimedEvents)
        .where(eventWhere(schema.graduatedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "graduated",
        totalEscrowed: 950n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the receipt claim when its market projection is missing", async () => {
      const record = graduatedReceiptClaimedRecord({
        marketId: 104n,
        receiptId: 10401n,
        byte: "b4",
      });

      await expect(
        persistGraduatedReceiptClaimedRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.graduatedReceiptClaimedEvents.id })
        .from(schema.graduatedReceiptClaimedEvents)
        .where(eventWhere(schema.graduatedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistRefundedReceiptClaimedRecord", () => {
    it("persists the full receipt-linked refund and subtracts it once", async () => {
      const record = refundedReceiptClaimedRecord();

      await persistRefundedReceiptClaimedRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.refundedReceiptClaimedEvents)
        .where(eventWhere(schema.refundedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(rows[0]).toMatchObject({
        marketId: MARKET.refundedReceiptClaimed,
        owner: OWNER_B,
        receiptId: 501n,
        refund: 300n,
      });
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "refunded",
        totalEscrowed: 600n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistRefundedReceiptClaimedRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.refundedReceiptClaimedEvents)
        .where(eventWhere(schema.refundedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "refunded",
        totalEscrowed: 600n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the receipt claim when its market projection is missing", async () => {
      const record = refundedReceiptClaimedRecord({
        marketId: 105n,
        receiptId: 10501n,
        byte: "b5",
      });

      await expect(
        persistRefundedReceiptClaimedRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.refundedReceiptClaimedEvents.id })
        .from(schema.refundedReceiptClaimedEvents)
        .where(eventWhere(schema.refundedReceiptClaimedEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistMarketRefundsAvailableRecord", () => {
    it("persists the refund-opening event once and projects its escrow once", async () => {
      const record = marketRefundsAvailableRecord();

      await persistMarketRefundsAvailableRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.marketRefundsAvailableEvents)
        .where(eventWhere(schema.marketRefundsAvailableEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "refunded",
        totalEscrowed: 800n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistMarketRefundsAvailableRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.marketRefundsAvailableEvents)
        .where(eventWhere(schema.marketRefundsAvailableEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "refunded",
        totalEscrowed: 800n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the event when its market projection is missing", async () => {
      const record = marketRefundsAvailableRecord({
        marketId: 106n,
        byte: "b6",
      });

      await expect(
        persistMarketRefundsAvailableRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.marketRefundsAvailableEvents.id })
        .from(schema.marketRefundsAvailableEvents)
        .where(eventWhere(schema.marketRefundsAvailableEvents, record));
      expect(rows).toHaveLength(0);
    });
  });

  describe("persistMarketCancelledRecord", () => {
    it("persists the cancellation event once and projects its escrow once", async () => {
      const record = marketCancelledRecord();

      await persistMarketCancelledRecord(record, dbc);

      let rows = await dbc
        .select()
        .from(schema.marketCancelledEvents)
        .where(eventWhere(schema.marketCancelledEvents, record));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject(record);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "cancelled",
        totalEscrowed: 700n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });

      await persistMarketCancelledRecord(record, dbc);

      rows = await dbc
        .select()
        .from(schema.marketCancelledEvents)
        .where(eventWhere(schema.marketCancelledEvents, record));
      expect(rows).toHaveLength(1);
      expect(await marketProjection(record.marketId)).toEqual({
        noShares: 0n,
        receiptCount: 0n,
        status: "cancelled",
        totalEscrowed: 700n,
        updatedAt: BLOCK_TIMESTAMP,
        yesShares: 0n,
      });
    });

    it("rolls back the event when its market projection is missing", async () => {
      const record = marketCancelledRecord({ marketId: 107n, byte: "b7" });

      await expect(
        persistMarketCancelledRecord(record, dbc),
      ).rejects.toBeInstanceOf(MarketNotIndexedError);

      const rows = await dbc
        .select({ id: schema.marketCancelledEvents.id })
        .from(schema.marketCancelledEvents)
        .where(eventWhere(schema.marketCancelledEvents, record));
      expect(rows).toHaveLength(0);
    });
  });
});

function marketSeed(
  marketId: bigint,
  status: typeof schema.markets.$inferInsert.status,
  totalEscrowed: bigint,
): typeof schema.markets.$inferInsert {
  return {
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId,
    createdBlockNumber: 90n + marketId,
    createdBlockTimestamp: new Date("2026-07-13T00:00:00.000Z"),
    createdLogIndex: Number(marketId),
    createdTransactionHash: transactionHash(`0${marketId}`),
    creator: OWNER_A,
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-08-01T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId,
    metadataHash: `0x${marketId.toString(16).padStart(64, "0")}`,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-09-01T00:00:00.000Z"),
    status,
    totalEscrowed,
  };
}

function receiptSeed({
  cost,
  marketId,
  owner,
  receiptId,
  transactionByte,
}: {
  cost: bigint;
  marketId: bigint;
  owner: string;
  receiptId: bigint;
  transactionByte: string;
}): typeof schema.receiptPlacedEvents.$inferInsert {
  return {
    blockNumber: 95n,
    blockTimestamp: new Date("2026-07-13T12:00:00.000Z"),
    chainId: CHAIN_ID,
    contractId,
    cost,
    logIndex: 0,
    marketId,
    owner,
    receiptId,
    rHigh: "500000000000000000",
    rLow: "0",
    sequence: receiptId,
    shares: cost,
    side: 0,
    transactionHash: transactionHash(transactionByte),
  };
}

function graduationStartedRecord({
  marketId = MARKET.graduationStarted,
  byte = "11",
}: {
  marketId?: bigint;
  byte?: string;
} = {}) {
  return buildGraduationStartedRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      {
        graduationStartedAt: 1_784_035_200n,
        manager: "0x00000000000000000000000000000000000000EE",
        marketId,
        noShares: 12n,
        path: -5n,
        receiptCount: 4n,
        snapshotHash: `0x${"ab".repeat(32)}`,
        totalEscrowed: 100n,
        yesShares: 17n,
      },
      byte,
    ) as GraduationStartedLog,
  });
}

function clearingRootSubmittedRecord({
  marketId = MARKET.clearingRootSubmitted,
  byte = "12",
}: {
  marketId?: bigint;
  byte?: string;
} = {}) {
  return buildClearingRootSubmittedRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      {
        challengeDeadline: 1_784_038_800n,
        completeSetCount: 400n,
        marketId,
        matchedMarketCap: 400n,
        merkleRoot: `0x${"cd".repeat(32)}`,
        refundTotal: 90n,
        retainedCostTotal: 400n,
        snapshotHash: `0x${"ab".repeat(32)}`,
        submittedAt: 1_784_035_200n,
        submitter: "0x00000000000000000000000000000000000000FF",
      },
      byte,
    ) as ClearingRootSubmittedLog,
  });
}

function graduationFinalizedRecord({
  marketId = MARKET.graduationFinalized,
  byte = "13",
}: {
  marketId?: bigint;
  byte?: string;
} = {}) {
  return buildGraduationFinalizedRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      {
        completeSetCount: 400n,
        marketId,
        postgradAdapter: "0x0000000000000000000000000000000000000011",
        postgradMarket: "0x0000000000000000000000000000000000000022",
        refundTotal: 90n,
        retainedCostTotal: 400n,
      },
      byte,
    ) as GraduationFinalizedLog,
  });
}

function graduatedReceiptClaimedRecord({
  marketId = MARKET.graduatedReceiptClaimed,
  receiptId = 401n,
  byte = "14",
}: {
  marketId?: bigint;
  receiptId?: bigint;
  byte?: string;
} = {}) {
  return buildGraduatedReceiptClaimedRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      {
        marketId,
        owner: OWNER_A,
        receiptId,
        refund: 50n,
        retainedCost: 200n,
        retainedShares: 225n,
        side: 0,
      },
      byte,
    ) as GraduatedReceiptClaimedLog,
  });
}

function refundedReceiptClaimedRecord({
  marketId = MARKET.refundedReceiptClaimed,
  receiptId = 501n,
  byte = "15",
}: {
  marketId?: bigint;
  receiptId?: bigint;
  byte?: string;
} = {}) {
  return buildRefundedReceiptClaimedRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      {
        marketId,
        owner: OWNER_B,
        receiptId,
        refund: 300n,
      },
      byte,
    ) as RefundedReceiptClaimedLog,
  });
}

function marketRefundsAvailableRecord({
  marketId = MARKET.refundsAvailable,
  byte = "16",
}: {
  marketId?: bigint;
  byte?: string;
} = {}) {
  return buildMarketRefundsAvailableRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog(
      { marketId, totalEscrowed: 800n },
      byte,
    ) as MarketRefundsAvailableLog,
  });
}

function marketCancelledRecord({
  marketId = MARKET.cancelled,
  byte = "17",
}: {
  marketId?: bigint;
  byte?: string;
} = {}) {
  return buildMarketCancelledRecord({
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId,
    log: baseLog({ marketId, totalEscrowed: 700n }, byte) as MarketCancelledLog,
  });
}

function baseLog(args: Record<string, unknown>, byte: string) {
  return {
    args,
    blockNumber: 100n,
    logIndex: 2,
    transactionHash: transactionHash(byte),
  };
}

function transactionHash(byte: string): `0x${string}` {
  return `0x${byte.padStart(2, "0").repeat(32)}`;
}

type EventIdentityTable = {
  chainId: AnyPgColumn;
  logIndex: AnyPgColumn;
  transactionHash: AnyPgColumn;
};

function eventWhere(
  table: EventIdentityTable,
  record: { chainId: number; logIndex: number; transactionHash: string },
) {
  return and(
    eq(table.chainId, record.chainId),
    eq(table.transactionHash, record.transactionHash),
    eq(table.logIndex, record.logIndex),
  );
}

async function marketProjection(marketId: bigint) {
  const [row] = await dbc
    .select({
      noShares: schema.markets.noShares,
      receiptCount: schema.markets.receiptCount,
      status: schema.markets.status,
      totalEscrowed: schema.markets.totalEscrowed,
      updatedAt: schema.markets.updatedAt,
      yesShares: schema.markets.yesShares,
    })
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.chainId, CHAIN_ID),
        eq(schema.markets.marketId, marketId),
      ),
    );
  return row;
}
