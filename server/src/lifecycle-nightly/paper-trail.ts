import {
  completeSetBinaryMarketAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { and, db, eq, schema } from "src/db/client";

import { chainId, pregradManagerAddress, publicClient } from "./stack";

/**
 * Market-scoped verification of the money paper-trail invariant
 * (docs/portfolio-data-design.md): every value transfer leaves exactly one
 * immutable, receipt-linked DB record sourced from an on-chain event — never
 * inferred, never dropped. Reconciles chain logs against the event tables in
 * BOTH directions (a missing row is a dropped transfer, an unmatched row is a
 * fabricated one) and re-derives the per-receipt money identities.
 *
 * Everything is keyed by the market under test, so a long-lived local
 * database with rows from other runs can never affect the verdict.
 */

type LedgerEntry = {
  amounts: Record<string, bigint>;
  key: string;
};

export async function assertMarketPaperTrail({
  createdBlock,
  marketId,
  postgradMarketAddress,
}: {
  createdBlock: bigint;
  marketId: bigint;
  postgradMarketAddress?: Address;
}): Promise<void> {
  const failures: string[] = [];

  const pregradLogs = await publicClient.getContractEvents({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    fromBlock: createdBlock,
  });
  const forMarket = pregradLogs.filter(
    (log) =>
      "marketId" in (log.args as Record<string, unknown>) &&
      (log.args as { marketId?: bigint }).marketId === marketId,
  );
  const byName = (eventName: string) =>
    forMarket.filter((log) => log.eventName === eventName);

  const receiptPlaced = byName("ReceiptPlaced");
  const graduatedClaims = byName("GraduatedReceiptClaimed");
  const refundedClaims = byName("RefundedReceiptClaimed");

  reconcile(
    failures,
    "receipt_placed_events",
    toEntries(receiptPlaced, ["shares", "cost"]),
    (await selectRows(schema.receiptPlacedEvents, marketId)).map((row) => ({
      amounts: { cost: row.cost, shares: row.shares },
      key: rowKey(row),
    })),
  );
  reconcile(
    failures,
    "graduation_started_events",
    toEntries(byName("GraduationStarted"), []),
    (await selectRows(schema.graduationStartedEvents, marketId)).map((row) => ({
      amounts: {},
      key: rowKey(row),
    })),
  );
  reconcile(
    failures,
    "clearing_root_submitted_events",
    toEntries(byName("ClearingRootSubmitted"), [
      "retainedCostTotal",
      "refundTotal",
    ]),
    (await selectRows(schema.clearingRootSubmittedEvents, marketId)).map(
      (row) => ({
        amounts: {
          refundTotal: row.refundTotal,
          retainedCostTotal: row.retainedCostTotal,
        },
        key: rowKey(row),
      }),
    ),
  );
  reconcile(
    failures,
    "graduation_finalized_events",
    toEntries(byName("GraduationFinalized"), [
      "retainedCostTotal",
      "refundTotal",
    ]),
    (await selectRows(schema.graduationFinalizedEvents, marketId)).map(
      (row) => ({
        amounts: {
          refundTotal: row.refundTotal,
          retainedCostTotal: row.retainedCostTotal,
        },
        key: rowKey(row),
      }),
    ),
  );
  reconcile(
    failures,
    "graduated_receipt_claimed_events",
    toEntries(graduatedClaims, ["retainedShares", "retainedCost", "refund"]),
    (await selectRows(schema.graduatedReceiptClaimedEvents, marketId)).map(
      (row) => ({
        amounts: {
          refund: row.refund,
          retainedCost: row.retainedCost,
          retainedShares: row.retainedShares,
        },
        key: rowKey(row),
      }),
    ),
  );
  reconcile(
    failures,
    "refunded_receipt_claimed_events",
    toEntries(refundedClaims, ["refund"]),
    (await selectRows(schema.refundedReceiptClaimedEvents, marketId)).map(
      (row) => ({
        amounts: { refund: row.refund },
        key: rowKey(row),
      }),
    ),
  );
  reconcile(
    failures,
    "market_refunds_available_events",
    toEntries(byName("MarketRefundsAvailable"), []),
    (await selectRows(schema.marketRefundsAvailableEvents, marketId)).map(
      (row) => ({ amounts: {}, key: rowKey(row) }),
    ),
  );
  reconcile(
    failures,
    "market_cancelled_events",
    toEntries(byName("MarketCancelled"), []),
    (await selectRows(schema.marketCancelledEvents, marketId)).map((row) => ({
      amounts: {},
      key: rowKey(row),
    })),
  );

  assertReceiptMoneyIdentities({
    failures,
    graduatedClaims,
    receiptPlaced,
    refundedClaims,
  });

  if (postgradMarketAddress) {
    await reconcilePostgrad({
      createdBlock,
      failures,
      marketId,
      postgradMarketAddress,
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `Money paper trail violated for market ${marketId}:\n- ${failures.join("\n- ")}`,
    );
  }
}

/**
 * Per-receipt money identities, re-derived from raw chain logs rather than
 * from any service's arithmetic: a graduated claim splits the receipt's cost
 * exactly into retained + refund, and a refunded claim returns it whole.
 */
function assertReceiptMoneyIdentities({
  failures,
  graduatedClaims,
  receiptPlaced,
  refundedClaims,
}: {
  failures: string[];
  graduatedClaims: readonly { args: unknown }[];
  receiptPlaced: readonly { args: unknown }[];
  refundedClaims: readonly { args: unknown }[];
}): void {
  const costByReceipt = new Map<bigint, bigint>();
  for (const log of receiptPlaced) {
    const args = log.args as { cost: bigint; receiptId: bigint };
    costByReceipt.set(args.receiptId, args.cost);
  }

  for (const log of graduatedClaims) {
    const args = log.args as {
      receiptId: bigint;
      refund: bigint;
      retainedCost: bigint;
    };
    const cost = costByReceipt.get(args.receiptId);

    if (cost === undefined) {
      failures.push(
        `graduated claim for receipt ${args.receiptId} has no ReceiptPlaced log`,
      );
    } else if (args.retainedCost + args.refund !== cost) {
      failures.push(
        `receipt ${args.receiptId}: retainedCost ${args.retainedCost} + refund ${args.refund} != cost ${cost}`,
      );
    }
  }

  for (const log of refundedClaims) {
    const args = log.args as { receiptId: bigint; refund: bigint };
    const cost = costByReceipt.get(args.receiptId);

    if (cost === undefined) {
      failures.push(
        `refunded claim for receipt ${args.receiptId} has no ReceiptPlaced log`,
      );
    } else if (args.refund !== cost) {
      failures.push(
        `receipt ${args.receiptId}: full refund ${args.refund} != cost ${cost}`,
      );
    }
  }
}

/**
 * Postgrad legs: resolution/cancellation status events and the collateral
 * side of every redemption, plus overall conservation — collateral redeemed
 * out of the postgrad market can never exceed what moved in (retained
 * clearing collateral plus complete-set mints, minus merges).
 */
async function reconcilePostgrad({
  createdBlock,
  failures,
  marketId,
  postgradMarketAddress,
}: {
  createdBlock: bigint;
  failures: string[];
  marketId: bigint;
  postgradMarketAddress: Address;
}): Promise<void> {
  const logs = await publicClient.getContractEvents({
    abi: completeSetBinaryMarketAbi,
    address: postgradMarketAddress,
    fromBlock: createdBlock,
  });
  const byName = (eventName: string) =>
    logs.filter((log) => log.eventName === eventName);

  const redeemed = byName("Redeemed");
  const cancelledRedeemed = byName("CancelledRedeemed");

  const redemptionRows = await db
    .select()
    .from(schema.postgradRedemptionEvents)
    .where(
      and(
        eq(schema.postgradRedemptionEvents.chainId, chainId),
        eq(schema.postgradRedemptionEvents.marketId, marketId),
      ),
    );
  reconcile(
    failures,
    "postgrad_redemption_events",
    [
      ...toEntries(redeemed, ["outcomeAmount", "collateralAmount"]),
      ...toEntries(cancelledRedeemed, [
        "yesAmount",
        "noAmount",
        "collateralAmount",
      ]),
    ],
    redemptionRows.map((row) => ({
      amounts: {
        collateralAmount: row.collateralAmount,
        ...(row.outcomeAmount === null
          ? {}
          : { outcomeAmount: row.outcomeAmount }),
        ...(row.yesAmount === null ? {} : { yesAmount: row.yesAmount }),
        ...(row.noAmount === null ? {} : { noAmount: row.noAmount }),
      },
      key: rowKey(row),
    })),
  );

  const resolutionRows = await db
    .select()
    .from(schema.postgradResolutionEvents)
    .where(
      and(
        eq(schema.postgradResolutionEvents.chainId, chainId),
        eq(schema.postgradResolutionEvents.marketId, marketId),
      ),
    );
  reconcile(
    failures,
    "postgrad_resolution_events",
    [
      ...toEntries(byName("MarketResolved"), []),
      ...toEntries(byName("MarketCancelled"), []),
    ],
    resolutionRows.map((row) => ({ amounts: {}, key: rowKey(row) })),
  );

  const collateralIn =
    sumArg(byName("RetainedCollateralFunded"), "collateralAmount") +
    sumArg(byName("CompleteSetsMinted"), "collateralAmount") -
    sumArg(byName("CompleteSetsMerged"), "collateralAmount");
  const collateralOut =
    sumArg(redeemed, "collateralAmount") +
    sumArg(cancelledRedeemed, "collateralAmount");

  if (collateralOut > collateralIn) {
    failures.push(
      `postgrad market paid out ${collateralOut} collateral but only ${collateralIn} moved in`,
    );
  }
}

/**
 * Two-way (chainTx, logIndex) reconciliation: every chain log has exactly one
 * DB row and every DB row points back at a chain log, with equal amounts.
 */
function reconcile(
  failures: string[],
  table: string,
  chainEntries: readonly LedgerEntry[],
  dbEntries: readonly LedgerEntry[],
): void {
  const chainByKey = new Map(chainEntries.map((entry) => [entry.key, entry]));
  const dbByKey = new Map(dbEntries.map((entry) => [entry.key, entry]));

  if (dbEntries.length !== dbByKey.size) {
    failures.push(`${table}: duplicate (transaction, logIndex) rows`);
  }

  for (const [key, chainEntry] of chainByKey) {
    const dbEntry = dbByKey.get(key);

    if (!dbEntry) {
      failures.push(`${table}: chain log ${key} has no DB row (dropped)`);
      continue;
    }

    for (const [field, chainValue] of Object.entries(chainEntry.amounts)) {
      const dbValue = dbEntry.amounts[field];
      if (dbValue !== chainValue) {
        failures.push(
          `${table}: ${key} ${field} mismatch (chain ${chainValue}, db ${dbValue})`,
        );
      }
    }
  }

  for (const key of dbByKey.keys()) {
    if (!chainByKey.has(key)) {
      failures.push(`${table}: DB row ${key} has no chain log (fabricated)`);
    }
  }
}

function toEntries(
  logs: readonly {
    args: unknown;
    logIndex: number;
    transactionHash: `0x${string}`;
  }[],
  amountFields: readonly string[],
): LedgerEntry[] {
  return logs.map((log) => {
    const args = log.args as Record<string, bigint>;
    const amounts: Record<string, bigint> = {};

    for (const field of amountFields) {
      const value = args[field];
      if (value === undefined) {
        throw new Error(
          `Expected event field ${field} missing on log ${log.transactionHash}:${log.logIndex}`,
        );
      }
      amounts[field] = value;
    }

    return {
      amounts,
      key: `${log.transactionHash.toLowerCase()}:${log.logIndex}`,
    };
  });
}

function sumArg(logs: readonly { args: unknown }[], field: string): bigint {
  return logs.reduce(
    (total, log) =>
      total + ((log.args as Record<string, bigint | undefined>)[field] ?? 0n),
    0n,
  );
}

function rowKey(row: { logIndex: number; transactionHash: string }): string {
  return `${row.transactionHash.toLowerCase()}:${row.logIndex}`;
}

type MarketScopedEventTable =
  | typeof schema.clearingRootSubmittedEvents
  | typeof schema.graduatedReceiptClaimedEvents
  | typeof schema.graduationFinalizedEvents
  | typeof schema.graduationStartedEvents
  | typeof schema.marketCancelledEvents
  | typeof schema.marketRefundsAvailableEvents
  | typeof schema.receiptPlacedEvents
  | typeof schema.refundedReceiptClaimedEvents;

async function selectRows<Table extends MarketScopedEventTable>(
  table: Table,
  marketId: bigint,
): Promise<Table["$inferSelect"][]> {
  return (await db
    .select()
    .from(table as MarketScopedEventTable)
    .where(
      and(eq(table.chainId, chainId), eq(table.marketId, marketId)),
    )) as Table["$inferSelect"][];
}
