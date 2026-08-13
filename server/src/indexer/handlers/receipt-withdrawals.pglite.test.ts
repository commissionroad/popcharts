// Real-SQL tier for the withdrawal paper trail. What only real SQL can show:
// the dedupe is a unique index on (chain, tx, log), so a replayed log is a
// no-op rather than a doubled movement; the rows foreign-key to
// receipt_placed_events (twice — withdrawing receipt AND the refuted kind's
// counterexample) and markets, all written by independent watchers, so a
// withdrawal log that outruns any parent must raise a *parkable* error rather
// than a raw constraint violation; and the finalized conservation write lands
// its `refunded` row in receipt_entry_fee_events under the finalized log's
// own key, atomically with the withdrawal row.
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
import { ReceiptNotIndexedError } from "src/indexer/handlers/entry-fees";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import {
  buildReceiptWithdrawalFinalizedRecord,
  buildReceiptWithdrawalRefutedRecord,
  buildReceiptWithdrawalRequestedRecord,
  buildReceiptWithdrawalVoidedRecord,
  buildWithdrawalChallengePeriodRecord,
  buildWithdrawalFeeRateRecord,
  buildWithdrawalFeeWithdrawalRecord,
  persistReceiptWithdrawalRecord,
  persistWithdrawalConfigRecord,
  persistWithdrawalFeeWithdrawalRecord,
  type EarnedWithdrawalFeesWithdrawnLog,
  type ReceiptWithdrawalFinalizedLog,
  type ReceiptWithdrawalRecord,
  type ReceiptWithdrawalRefutedLog,
  type ReceiptWithdrawalRequestedLog,
  type ReceiptWithdrawalVoidedLog,
  type WithdrawalChallengePeriodUpdatedLog,
  type WithdrawalConfigRecord,
  type WithdrawalFeeRateUpdatedLog,
  type WithdrawalFeeWithdrawalRecord,
} from "src/indexer/handlers/receipt-withdrawals";
import {
  RECEIPT_WITHDRAWAL_BUILDERS,
  WITHDRAWAL_CONFIG_BUILDERS,
} from "src/indexer/watchers/receipt-withdrawals";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const RECEIPT_ID = 3n;
const REFUTING_RECEIPT_ID = 4n;
const REQUEST_ID = 1n;
const OWNER = "0x00000000000000000000000000000000000000ab";
const CHALLENGER = "0x00000000000000000000000000000000000000ba";

// ADR 0014 §3-flavoured integers: escrowRefund == grossRefund − withdrawalFee.
const GROSS_REFUND = 13_350n;
const WITHDRAWAL_FEE = 667n;
const ESCROW_REFUND = 12_683n;
const ENTRY_FEE_REFUND = 133n;
const CHALLENGE_DEADLINE_UNIX = 1_772_064_000n;

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
    creator: OWNER,
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

async function seedReceipt(receiptId = RECEIPT_ID, logIndex = 0) {
  await dbc.insert(schema.receiptPlacedEvents).values({
    blockNumber: 100n,
    blockTimestamp: new Date("2026-08-05T00:00:01Z"),
    chainId: CHAIN_ID,
    contractId: 1,
    cost: 1_000_000n,
    logIndex,
    marketId: MARKET_ID,
    owner: OWNER,
    rHigh: "200",
    rLow: "100",
    receiptId,
    sequence: receiptId,
    shares: 100n,
    side: 0,
    transactionHash: `0x${"44".repeat(32)}`,
  });
}

function withdrawalRecord(
  overrides: Partial<ReceiptWithdrawalRecord["event"]> = {},
): ReceiptWithdrawalRecord {
  return {
    event: {
      account: OWNER,
      blockNumber: 200n,
      blockTimestamp: new Date("2026-08-05T00:00:02Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      kind: "requested",
      logIndex: 1,
      marketId: MARKET_ID,
      receiptId: RECEIPT_ID,
      requestId: REQUEST_ID,
      transactionHash: `0x${"88".repeat(32)}`,
      ...overrides,
    },
  };
}

function finalizedRecord(
  overrides: Partial<ReceiptWithdrawalRecord["event"]> = {},
): ReceiptWithdrawalRecord {
  return withdrawalRecord({
    blockNumber: 210n,
    entryFeeRefund: ENTRY_FEE_REFUND,
    escrowRefund: ESCROW_REFUND,
    kind: "finalized",
    logIndex: 0,
    transactionHash: `0x${"99".repeat(32)}`,
    withdrawalFee: WITHDRAWAL_FEE,
    ...overrides,
  });
}

function sweepRecord(
  overrides: Partial<WithdrawalFeeWithdrawalRecord["event"]> = {},
): WithdrawalFeeWithdrawalRecord {
  return {
    event: {
      amount: 5_000n,
      blockNumber: 300n,
      blockTimestamp: new Date("2026-08-06T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      logIndex: 0,
      marketId: MARKET_ID,
      recipient: OWNER,
      transactionHash: `0x${"55".repeat(32)}`,
      ...overrides,
    },
  };
}

describe("persistReceiptWithdrawalRecord", () => {
  it("persists the request lifecycle and the finalized conservation write", async () => {
    await seedMarket();
    await seedReceipt();

    // One request's full happy path: requested (no money moves) then
    // finalized (the one transfer).
    await persistReceiptWithdrawalRecord(
      withdrawalRecord({
        challengeDeadline: new Date(Number(CHALLENGE_DEADLINE_UNIX) * 1000),
        challengeDeadlineUnix: CHALLENGE_DEADLINE_UNIX,
        entryFeeRefund: ENTRY_FEE_REFUND,
        grossRefund: GROSS_REFUND,
        nextReceiptIdSnapshot: 5n,
        segments: "100:150,180:200",
        withdrawalFee: WITHDRAWAL_FEE,
      }),
      dbc,
    );
    await persistReceiptWithdrawalRecord(finalizedRecord(), dbc);

    const rows = await dbc.select().from(schema.receiptWithdrawalEvents);
    expect(rows).toHaveLength(2);
    const byKind = Object.fromEntries(rows.map((row) => [row.kind, row]));

    expect(byKind.requested?.requestId).toBe(REQUEST_ID);
    expect(byKind.requested?.grossRefund).toBe(GROSS_REFUND);
    expect(byKind.requested?.withdrawalFee).toBe(WITHDRAWAL_FEE);
    expect(byKind.requested?.entryFeeRefund).toBe(ENTRY_FEE_REFUND);
    expect(byKind.requested?.segments).toBe("100:150,180:200");
    expect(byKind.requested?.challengeDeadlineUnix).toBe(
      CHALLENGE_DEADLINE_UNIX,
    );
    expect(byKind.requested?.nextReceiptIdSnapshot).toBe(5n);
    expect(byKind.requested?.escrowRefund).toBeNull();

    expect(byKind.finalized?.requestId).toBe(REQUEST_ID);
    expect(byKind.finalized?.escrowRefund).toBe(ESCROW_REFUND);
    expect(byKind.finalized?.entryFeeRefund).toBe(ENTRY_FEE_REFUND);
    expect(byKind.finalized?.withdrawalFee).toBe(WITHDRAWAL_FEE);
    expect(byKind.finalized?.account).toBe(OWNER);

    // The conservation write: finalization pays the withdrawn segments'
    // prepaid entry fee with no EntryFeeRefunded emitted, so the handler must
    // record the `refunded` movement itself — under the finalized log's own
    // (chain, tx, log) key — or collected == earned + refunded breaks.
    const feeRows = await dbc.select().from(schema.receiptEntryFeeEvents);
    expect(feeRows).toHaveLength(1);
    expect(feeRows[0]?.kind).toBe("refunded");
    expect(feeRows[0]?.amount).toBe(ENTRY_FEE_REFUND);
    expect(feeRows[0]?.account).toBe(OWNER);
    expect(feeRows[0]?.receiptId).toBe(RECEIPT_ID);
    expect(feeRows[0]?.transactionHash).toBe(
      byKind.finalized?.transactionHash as string,
    );
    expect(feeRows[0]?.logIndex).toBe(byKind.finalized?.logIndex as number);
  });

  it("writes no entry-fee movement when the finalized refund is zero", async () => {
    await seedMarket();
    await seedReceipt();

    // A zero refund moved no fee: an absent row means "no fee was due",
    // exactly the entry-fee table's convention.
    await persistReceiptWithdrawalRecord(
      finalizedRecord({ entryFeeRefund: 0n }),
      dbc,
    );

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.receiptEntryFeeEvents);
    expect(total).toBe(0);
  });

  it("treats a replayed log as a no-op in both ledgers", async () => {
    await seedMarket();
    await seedReceipt();

    await persistReceiptWithdrawalRecord(finalizedRecord(), dbc);
    await persistReceiptWithdrawalRecord(finalizedRecord(), dbc);

    const [{ total: withdrawalRows }] = await dbc
      .select({ total: count() })
      .from(schema.receiptWithdrawalEvents);
    const [{ total: feeRows }] = await dbc
      .select({ total: count() })
      .from(schema.receiptEntryFeeEvents);
    expect(withdrawalRows).toBe(1);
    expect(feeRows).toBe(1);
  });

  it("persists a refuted row once its counterexample receipt is indexed", async () => {
    await seedMarket();
    await seedReceipt();
    await seedReceipt(REFUTING_RECEIPT_ID, 1);

    await persistReceiptWithdrawalRecord(
      withdrawalRecord({
        account: CHALLENGER,
        kind: "refuted",
        refutingReceiptId: REFUTING_RECEIPT_ID,
      }),
      dbc,
    );

    const rows = await dbc.select().from(schema.receiptWithdrawalEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("refuted");
    expect(rows[0]?.account).toBe(CHALLENGER);
    expect(rows[0]?.refutingReceiptId).toBe(REFUTING_RECEIPT_ID);
  });

  it("parks when the withdrawal log outruns ReceiptPlaced", async () => {
    await seedMarket();
    // No receipt row: the independent-watcher race the FK exists to survive.
    await expect(
      persistReceiptWithdrawalRecord(withdrawalRecord(), dbc),
    ).rejects.toBeInstanceOf(ReceiptNotIndexedError);

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.receiptWithdrawalEvents);
    expect(total).toBe(0);
  });

  it("parks when the refuting receipt is not indexed yet", async () => {
    await seedMarket();
    // Only the withdrawing receipt: proves the counterexample check is not
    // shadowed by the first receipt check.
    await seedReceipt();

    await expect(
      persistReceiptWithdrawalRecord(
        withdrawalRecord({
          account: CHALLENGER,
          kind: "refuted",
          refutingReceiptId: REFUTING_RECEIPT_ID,
        }),
        dbc,
      ),
    ).rejects.toBeInstanceOf(ReceiptNotIndexedError);

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.receiptWithdrawalEvents);
    expect(total).toBe(0);
  });

  it("parks when the receipt row exists but the market row does not", async () => {
    // A receipt row's presence does not imply its market row's presence: the
    // two come from independent watchers.
    await seedReceipt();

    await expect(
      persistReceiptWithdrawalRecord(withdrawalRecord(), dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });
});

describe("persistWithdrawalConfigRecord", () => {
  function configRecord(
    overrides: Partial<WithdrawalConfigRecord["event"]> = {},
  ): WithdrawalConfigRecord {
    return {
      event: {
        blockNumber: 50n,
        blockTimestamp: new Date("2026-08-04T00:00:00Z"),
        chainId: CHAIN_ID,
        contractId: 1,
        kind: "fee_rate",
        logIndex: 0,
        newValue: 50_000_000_000_000_000n,
        previousValue: 0n,
        transactionHash: `0x${"66".repeat(32)}`,
        ...overrides,
      },
    };
  }

  it("persists both kinds with no parent requirements", async () => {
    // No market, no receipt: the rate and window exist before any market.
    await persistWithdrawalConfigRecord(configRecord(), dbc);
    await persistWithdrawalConfigRecord(
      configRecord({
        kind: "challenge_period",
        logIndex: 1,
        newValue: 86_400n,
      }),
      dbc,
    );

    const rows = await dbc.select().from(schema.withdrawalConfigEvents);
    expect(rows).toHaveLength(2);
    const byKind = Object.fromEntries(rows.map((row) => [row.kind, row]));
    expect(byKind.fee_rate?.newValue).toBe(50_000_000_000_000_000n);
    expect(byKind.fee_rate?.previousValue).toBe(0n);
    expect(byKind.challenge_period?.newValue).toBe(86_400n);
  });

  it("treats a replayed log as a no-op", async () => {
    await persistWithdrawalConfigRecord(configRecord(), dbc);
    await persistWithdrawalConfigRecord(configRecord(), dbc);

    const [{ total }] = await dbc
      .select({ total: count() })
      .from(schema.withdrawalConfigEvents);
    expect(total).toBe(1);
  });
});

describe("persistWithdrawalFeeWithdrawalRecord", () => {
  it("persists a sweep and dedupes a replay", async () => {
    await seedMarket();

    await persistWithdrawalFeeWithdrawalRecord(sweepRecord(), dbc);
    await persistWithdrawalFeeWithdrawalRecord(sweepRecord(), dbc);

    const rows = await dbc.select().from(schema.withdrawalFeeWithdrawalEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipient).toBe(OWNER);
    expect(rows[0]?.amount).toBe(5_000n);
  });

  it("parks when the market row is missing", async () => {
    await expect(
      persistWithdrawalFeeWithdrawalRecord(sweepRecord(), dbc),
    ).rejects.toBeInstanceOf(MarketNotIndexedError);
  });
});

describe("buildReceiptWithdrawal*Record", () => {
  const context = {
    blockTimestamp: new Date("2026-08-05T00:00:02Z"),
    config: { chainId: CHAIN_ID },
    contractId: 1,
  };
  // A complete viem Log shape so the per-event casts are valid: the builders
  // only read blockNumber/logIndex/transactionHash/args, but TS rightly
  // refuses a cast from a literal missing half the Log fields.
  const baseLog = {
    address: "0x00000000000000000000000000000000000000cc",
    blockHash: `0x${"77".repeat(32)}`,
    blockNumber: 200n,
    data: "0x",
    logIndex: 1,
    removed: false,
    // Typed as the empty tuple: viem's Log narrows topics to a tuple union,
    // and an untyped [] infers never[], which defeats the per-event casts.
    topics: [] as [],
    transactionHash: `0x${"88".repeat(32)}`,
    transactionIndex: 0,
  };

  it("maps a requested log: segments encoding, lowercase owner, deadline date", () => {
    const requested = buildReceiptWithdrawalRequestedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          challengeDeadline: CHALLENGE_DEADLINE_UNIX,
          entryFeeRefund: ENTRY_FEE_REFUND,
          grossRefund: GROSS_REFUND,
          marketId: MARKET_ID,
          nextReceiptIdSnapshot: 5n,
          owner: OWNER.toUpperCase().replace("0X", "0x"),
          receiptId: RECEIPT_ID,
          requestId: REQUEST_ID,
          // A negative path bound pins the encoder on int256 coordinates.
          segments: [
            { rHigh: 150n, rLow: -50n },
            { rHigh: 200n, rLow: 180n },
          ],
          withdrawalFee: WITHDRAWAL_FEE,
        },
      } as ReceiptWithdrawalRequestedLog,
    });

    expect(requested.event.kind).toBe("requested");
    expect(requested.event.account).toBe(OWNER);
    expect(requested.event.segments).toBe("-50:150,180:200");
    expect(requested.event.grossRefund).toBe(GROSS_REFUND);
    expect(requested.event.withdrawalFee).toBe(WITHDRAWAL_FEE);
    expect(requested.event.entryFeeRefund).toBe(ENTRY_FEE_REFUND);
    expect(requested.event.challengeDeadlineUnix).toBe(CHALLENGE_DEADLINE_UNIX);
    expect(requested.event.challengeDeadline).toEqual(
      new Date(Number(CHALLENGE_DEADLINE_UNIX) * 1000),
    );
    expect(requested.event.nextReceiptIdSnapshot).toBe(5n);
  });

  it("maps refuted, finalized, and voided logs to their kinds", () => {
    const refuted = buildReceiptWithdrawalRefutedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          challenger: CHALLENGER.toUpperCase().replace("0X", "0x"),
          marketId: MARKET_ID,
          receiptId: RECEIPT_ID,
          refutingReceiptId: REFUTING_RECEIPT_ID,
          requestId: REQUEST_ID,
        },
      } as ReceiptWithdrawalRefutedLog,
    });
    expect(refuted.event.kind).toBe("refuted");
    expect(refuted.event.account).toBe(CHALLENGER);
    expect(refuted.event.refutingReceiptId).toBe(REFUTING_RECEIPT_ID);

    const finalized = buildReceiptWithdrawalFinalizedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          entryFeeRefund: ENTRY_FEE_REFUND,
          escrowRefund: ESCROW_REFUND,
          marketId: MARKET_ID,
          owner: OWNER,
          receiptId: RECEIPT_ID,
          requestId: REQUEST_ID,
          withdrawalFee: WITHDRAWAL_FEE,
        },
      } as ReceiptWithdrawalFinalizedLog,
    });
    expect(finalized.event.kind).toBe("finalized");
    expect(finalized.event.escrowRefund).toBe(ESCROW_REFUND);
    expect(finalized.event.entryFeeRefund).toBe(ENTRY_FEE_REFUND);
    expect(finalized.event.withdrawalFee).toBe(WITHDRAWAL_FEE);

    const voided = buildReceiptWithdrawalVoidedRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          marketId: MARKET_ID,
          receiptId: RECEIPT_ID,
          requestId: REQUEST_ID,
        },
      } as ReceiptWithdrawalVoidedLog,
    });
    expect(voided.event.kind).toBe("voided");
    // `account` is null exactly for `voided`: the contract emits no address.
    expect(voided.event.account).toBeNull();
  });

  it("maps the config logs to their kinds and values", () => {
    const feeRate = buildWithdrawalFeeRateRecord({
      ...context,
      log: {
        ...baseLog,
        args: { newRateWad: 50_000_000_000_000_000n, previousRateWad: 0n },
      } as WithdrawalFeeRateUpdatedLog,
    });
    expect(feeRate.event.kind).toBe("fee_rate");
    expect(feeRate.event.previousValue).toBe(0n);
    expect(feeRate.event.newValue).toBe(50_000_000_000_000_000n);

    const period = buildWithdrawalChallengePeriodRecord({
      ...context,
      log: {
        ...baseLog,
        args: { newPeriod: 86_400n, previousPeriod: 0n },
      } as WithdrawalChallengePeriodUpdatedLog,
    });
    expect(period.event.kind).toBe("challenge_period");
    expect(period.event.newValue).toBe(86_400n);
  });

  it("maps a sweep log with a lowercased recipient", () => {
    const sweep = buildWithdrawalFeeWithdrawalRecord({
      ...context,
      log: {
        ...baseLog,
        args: {
          amount: 5_000n,
          marketId: MARKET_ID,
          recipient: OWNER.toUpperCase().replace("0X", "0x"),
        },
      } as EarnedWithdrawalFeesWithdrawnLog,
    });
    expect(sweep.event.recipient).toBe(OWNER);
    expect(sweep.event.marketId).toBe(MARKET_ID);
  });

  it("wires each watcher dispatch key to the builder producing its kind", () => {
    // The builder maps' value types accept any watcher log, so TypeScript
    // cannot catch ReceiptWithdrawalRequested wired to the voided builder;
    // this pins the name-to-kind mapping instead.
    const mergedArgs = {
      amount: 1n,
      challengeDeadline: CHALLENGE_DEADLINE_UNIX,
      challenger: CHALLENGER,
      entryFeeRefund: 1n,
      escrowRefund: 1n,
      grossRefund: 1n,
      marketId: MARKET_ID,
      newPeriod: 1n,
      newRateWad: 1n,
      nextReceiptIdSnapshot: 1n,
      owner: OWNER,
      previousPeriod: 0n,
      previousRateWad: 0n,
      receiptId: RECEIPT_ID,
      recipient: OWNER,
      refutingReceiptId: REFUTING_RECEIPT_ID,
      requestId: REQUEST_ID,
      segments: [{ rHigh: 150n, rLow: 100n }],
      withdrawalFee: 1n,
    };
    const buildContext = {
      blockTimestamp: context.blockTimestamp,
      config: config as never,
      contractId: context.contractId,
      log: { ...baseLog, args: mergedArgs } as never,
    };

    const lifecycleWiring = {
      ReceiptWithdrawalFinalized: "finalized",
      ReceiptWithdrawalRefuted: "refuted",
      ReceiptWithdrawalRequested: "requested",
      ReceiptWithdrawalVoided: "voided",
    } as const;
    for (const [eventName, expectedKind] of Object.entries(lifecycleWiring)) {
      const record =
        RECEIPT_WITHDRAWAL_BUILDERS[
          eventName as keyof typeof RECEIPT_WITHDRAWAL_BUILDERS
        ](buildContext);
      expect(record.event.kind).toBe(expectedKind);
    }

    const configWiring = {
      WithdrawalChallengePeriodUpdated: "challenge_period",
      WithdrawalFeeRateUpdated: "fee_rate",
    } as const;
    for (const [eventName, expectedKind] of Object.entries(configWiring)) {
      const record =
        WITHDRAWAL_CONFIG_BUILDERS[
          eventName as keyof typeof WITHDRAWAL_CONFIG_BUILDERS
        ](buildContext);
      expect(record.event.kind).toBe(expectedKind);
    }
  });

  it("rejects a log missing a required value", () => {
    expect(() =>
      buildReceiptWithdrawalRequestedRecord({
        ...context,
        log: {
          ...baseLog,
          args: {
            challengeDeadline: CHALLENGE_DEADLINE_UNIX,
            entryFeeRefund: ENTRY_FEE_REFUND,
            grossRefund: GROSS_REFUND,
            marketId: MARKET_ID,
            nextReceiptIdSnapshot: 5n,
            receiptId: RECEIPT_ID,
            requestId: REQUEST_ID,
            segments: [{ rHigh: 150n, rLow: 100n }],
            withdrawalFee: WITHDRAWAL_FEE,
          },
        } as ReceiptWithdrawalRequestedLog,
      }),
    ).toThrow(/owner/);

    expect(() =>
      buildWithdrawalFeeWithdrawalRecord({
        ...context,
        log: {
          ...baseLog,
          args: { amount: 5_000n, marketId: MARKET_ID },
        } as EarnedWithdrawalFeesWithdrawnLog,
      }),
    ).toThrow(/recipient/);
  });
});
