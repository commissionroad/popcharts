// Real-SQL tier for the entry-fee paper trail. What only real SQL can show:
// the dedupe is a unique index on (chain, tx, log), so a replayed log is a
// no-op rather than a doubled fee movement; and the rows foreign-key to BOTH
// receipt_placed_events and markets, written by independent watchers, so a
// fee log that outruns either parent must raise a *parkable* error rather
// than a raw constraint violation that abandons the sweep pass.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { count } from "drizzle-orm";

import { config } from "src/config";
import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import {
  buildEntryFeeCollectedRecord,
  buildEntryFeeEarnedRecord,
  buildEntryFeeRefundedRecord,
  buildEntryFeeWithdrawalRecord,
  persistEntryFeeWithdrawalRecord,
  persistReceiptEntryFeeRecord,
  ReceiptNotIndexedError,
  type EarnedEntryFeesWithdrawnLog,
  type EntryFeeCollectedLog,
  type EntryFeeEarnedLog,
  type EntryFeeRefundedLog,
  type EntryFeeWithdrawalRecord,
  type ReceiptEntryFeeRecord,
} from "src/indexer/handlers/entry-fees";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import { RECEIPT_FEE_BUILDERS } from "src/indexer/watchers/entry-fees";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const RECEIPT_ID = 3n;
const PAYER = "0x00000000000000000000000000000000000000ab";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One PGlite per file, emptied between tests — see the note in
// review-bond.pglite.test.ts on why an instance per test exhausts memory.
beforeEach(async () => {
  await resetDb();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
});

async function seedMarket() {
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-08-05T00:00:00Z"),
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: PAYER,
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-09-01T00:00:00Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: `0x${"22".repeat(32)}`,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-10-01T00:00:00Z"),
    status: "under_review",
  });
}

async function seedReceipt() {
  await dbc.insert(schema.receiptPlacedEvents).values({
    blockNumber: 100n,
    blockTimestamp: new Date("2026-08-05T00:00:01Z"),
    chainId: CHAIN_ID,
    contractId: 1,
    cost: 1_000_000n,
    logIndex: 0,
    marketId: MARKET_ID,
    owner: PAYER,
    rHigh: "200",
    rLow: "100",
    receiptId: RECEIPT_ID,
    sequence: 1n,
    shares: 100n,
    side: 0,
    transactionHash: `0x${"44".repeat(32)}`,
  });
}

function feeRecord(
  overrides: Partial<ReceiptEntryFeeRecord["event"]> = {},
): ReceiptEntryFeeRecord {
  return {
    event: {
      account: PAYER,
      amount: 10_000n,
      blockNumber: 100n,
      blockTimestamp: new Date("2026-08-05T00:00:01Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      kind: "collected",
      logIndex: 1,
      marketId: MARKET_ID,
      receiptId: RECEIPT_ID,
      transactionHash: `0x${"44".repeat(32)}`,
      ...overrides,
    },
  };
}

function withdrawalRecord(
  overrides: Partial<EntryFeeWithdrawalRecord["event"]> = {},
): EntryFeeWithdrawalRecord {
  return {
    event: {
      amount: 5_000n,
      blockNumber: 300n,
      blockTimestamp: new Date("2026-08-06T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      logIndex: 0,
      marketId: MARKET_ID,
      recipient: PAYER,
      transactionHash: `0x${"55".repeat(32)}`,
      ...overrides,
    },
  };
}

describe("persistReceiptEntryFeeRecord", () => {
  it("persists each kind and reconstructs the receipt's fee state by summation", async () => {
    await seedMarket();
    await seedReceipt();

    // The full lifecycle of one partially-filled receipt: collected at
    // placement, then split at the graduated claim into refunded + earned.
    await persistReceiptEntryFeeRecord(feeRecord(), dbc);
    await persistReceiptEntryFeeRecord(
      feeRecord({
        amount: 6_000n,
        kind: "refunded",
        logIndex: 2,
        transactionHash: `0x${"66".repeat(32)}`,
      }),
      dbc,
    );
    await persistReceiptEntryFeeRecord(
      feeRecord({
        account: null,
        amount: 4_000n,
        kind: "earned",
        logIndex: 3,
        transactionHash: `0x${"66".repeat(32)}`,
      }),
      dbc,
    );

    const rows = await dbc.select().from(schema.receiptEntryFeeEvents);
    expect(rows).toHaveLength(3);

    // Round-trip check, not a conservation proof: the contract enforces
    // collected == refunded + earned on-chain; what SQL must show is that
    // each movement's amount and kind survive persistence unchanged, so the
    // reconstruction-by-summation the schema doc promises stays possible.
    const byKind = Object.fromEntries(
      rows.map((row) => [row.kind, row.amount]),
    );
    expect(byKind.collected).toBe(10_000n);
    expect(byKind.refunded).toBe(6_000n);
    expect(byKind.earned).toBe(4_000n);
    // `account` is null exactly for `earned`.
    expect(rows.find((row) => row.kind === "earned")?.account).toBeNull();
    expect(rows.find((row) => row.kind === "collected")?.account).toBe(PAYER);
  });

  it("treats a replayed log as a no-op rather than a second movement", async () => {
    await seedMarket();
    await seedReceipt();

    await persistReceiptEntryFeeRecord(feeRecord(), dbc);
    await persistReceiptEntryFeeRecord(feeRecord(), dbc);

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.receiptEntryFeeEvents);
    expect(total).toBe(1);
  });

  it("parks when the fee log outruns ReceiptPlaced in the same transaction", async () => {
    await seedMarket();
    // No receipt row: the same-transaction race the FK exists to survive.
    await expect(
      persistReceiptEntryFeeRecord(feeRecord(), dbc),
    ).rejects.toBeInstanceOf(ReceiptNotIndexedError);

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.receiptEntryFeeEvents);
    expect(total).toBe(0);
  });

  it("parks when the receipt row exists but the market row does not", async () => {
    // A receipt row's presence does not imply its market row's presence: the
    // two come from independent watchers. Seeding only the receipt proves the
    // market check is not shadowed by the receipt check.
    await seedReceipt();

    await expect(
      persistReceiptEntryFeeRecord(feeRecord(), dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });
});

describe("persistEntryFeeWithdrawalRecord", () => {
  it("persists a withdrawal and dedupes a replay", async () => {
    await seedMarket();

    await persistEntryFeeWithdrawalRecord(withdrawalRecord(), dbc);
    await persistEntryFeeWithdrawalRecord(withdrawalRecord(), dbc);

    const rows = await dbc.select().from(schema.entryFeeWithdrawalEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipient).toBe(PAYER);
    expect(rows[0]?.amount).toBe(5_000n);
  });

  it("parks when the market row is missing", async () => {
    await expect(
      persistEntryFeeWithdrawalRecord(withdrawalRecord(), dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });
});

describe("buildEntryFee*Record", () => {
  const context = {
    blockTimestamp: new Date("2026-08-05T00:00:01Z"),
    config: { chainId: CHAIN_ID },
    contractId: 1,
  };
  // A complete viem Log shape so the per-event casts are valid: the builders
  // only read blockNumber/logIndex/transactionHash/args, but TS rightly
  // refuses a cast from a literal missing half the Log fields.
  const baseLog = {
    address: "0x00000000000000000000000000000000000000cc",
    blockHash: `0x${"77".repeat(32)}`,
    blockNumber: 100n,
    data: "0x",
    logIndex: 1,
    removed: false,
    topics: [],
    transactionHash: `0x${"44".repeat(32)}`,
    transactionIndex: 0,
  };

  it("lowercases accounts and maps each event to its kind", () => {
    const collected = buildEntryFeeCollectedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          amount: 10_000n,
          marketId: MARKET_ID,
          payer: PAYER.toUpperCase().replace("0X", "0x"),
          receiptId: RECEIPT_ID,
        },
      } as EntryFeeCollectedLog,
    });
    expect(collected.event.kind).toBe("collected");
    expect(collected.event.account).toBe(PAYER);

    const refunded = buildEntryFeeRefundedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          amount: 6_000n,
          marketId: MARKET_ID,
          recipient: PAYER.toUpperCase().replace("0X", "0x"),
          receiptId: RECEIPT_ID,
        },
      } as EntryFeeRefundedLog,
    });
    expect(refunded.event.kind).toBe("refunded");
    // The recipient lands in `account`, lowercased — a copy-paste of the
    // earned builder (account=null) or a missed toLowerCase must fail here.
    expect(refunded.event.account).toBe(PAYER);

    const earned = buildEntryFeeEarnedRecord({
      ...context,
      log: {
        ...baseLog,
        args: { amount: 4_000n, marketId: MARKET_ID, receiptId: RECEIPT_ID },
      } as EntryFeeEarnedLog,
    });
    expect(earned.event.kind).toBe("earned");
    expect(earned.event.account).toBeNull();
  });

  it("maps a withdrawal log with a lowercased recipient", () => {
    const withdrawal = buildEntryFeeWithdrawalRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          amount: 5_000n,
          marketId: MARKET_ID,
          recipient: PAYER.toUpperCase().replace("0X", "0x"),
        },
      } as EarnedEntryFeesWithdrawnLog,
    });
    expect(withdrawal.event.recipient).toBe(PAYER);
    expect(withdrawal.event.marketId).toBe(MARKET_ID);
  });

  it("wires each watcher dispatch key to the builder producing its kind", () => {
    // The builder map's value type accepts any watcher log, so TypeScript
    // cannot catch EntryFeeCollected wired to the refunded builder; this
    // pins the name-to-kind mapping instead.
    const wiring = {
      EntryFeeCollected: "collected",
      EntryFeeEarned: "earned",
      EntryFeeRefunded: "refunded",
    } as const;
    for (const [eventName, expectedKind] of Object.entries(wiring)) {
      const record = RECEIPT_FEE_BUILDERS[
        eventName as keyof typeof RECEIPT_FEE_BUILDERS
      ]({
        blockTimestamp: context.blockTimestamp,
        config: config as never,
        contractId: context.contractId,
        log: {
          ...baseLog,
          args: {
            amount: 1n,
            marketId: MARKET_ID,
            payer: PAYER,
            receiptId: RECEIPT_ID,
            recipient: PAYER,
          },
        } as never,
      });
      expect(record.event.kind).toBe(expectedKind);
    }
  });

  it("rejects a log missing a required value", () => {
    expect(() =>
      buildEntryFeeCollectedRecord({
        ...context,
        log: {
          ...baseLog,
          args: { amount: 10_000n, marketId: MARKET_ID, receiptId: RECEIPT_ID },
        } as EntryFeeCollectedLog,
      }),
    ).toThrow(/payer/);

    expect(() =>
      buildEntryFeeWithdrawalRecord({
        ...context,
        log: {
          ...baseLog,
          args: { amount: 5_000n, marketId: MARKET_ID },
        } as EarnedEntryFeesWithdrawnLog,
      }),
    ).toThrow(/recipient/);
  });
});
