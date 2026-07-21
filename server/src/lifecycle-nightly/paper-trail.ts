import {
  completeSetBinaryMarketAbi,
  contractSideToMarketSide,
  outcomeTokenAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { and, db, eq, inArray, schema } from "src/db/client";

import { chainId, pregradManagerAddress, publicClient } from "./stack";
import { waitForCondition } from "./wait";

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
 *
 * Attribution caveat: this proves the ledger is complete and chain-sourced,
 * not which writer produced it — the local graduation flow mirrors
 * settlement logs into the same tables the settlement watcher writes
 * (dev-market-graduate's mirrorSettlementLogs), idempotently on the same
 * (chainId, tx, logIndex) keys. Watcher liveness is proven separately:
 * scenarios wait for receipt rows before graduation can trigger, redemption
 * and transfer tables have no mirror path, and the ADR 0014 indexer-restart
 * drill exercises settlement watcher recovery directly.
 */

type LedgerEntry = {
  amounts: Record<string, bigint>;
  /** Non-numeric columns to compare (addresses pre-lowercased by callers). */
  fields?: Record<string, string | null>;
  key: string;
};

type PaperTrailTarget = {
  createdBlock: bigint;
  marketId: bigint;
  postgradMarketAddress?: Address;
};

/**
 * Retries `assertMarketPaperTrail` until it holds or the timeout elapses. The
 * indexer's dynamic postgrad watcher backfills a graduated venue's events
 * (complete-set mints, outcome-token transfers) a beat after graduation, so a
 * reconciliation run immediately after graduation can transiently see them as
 * dropped. A throwing reconciliation counts as not-ready; on timeout
 * waitForCondition surfaces the last failure (the full violations list), so a
 * genuine dropped/fabricated transfer still fails loudly. tickChain flushes
 * the indexer with the same throttled mining the other waits use.
 */
export async function assertMarketPaperTrailEventually(
  target: PaperTrailTarget,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  await waitForCondition(
    `paper trail balances for market ${target.marketId}`,
    async () => {
      await assertMarketPaperTrail(target);
      return true;
    },
    { tickChain: true, timeoutMs },
  );
}

export async function assertMarketPaperTrail({
  createdBlock,
  marketId,
  postgradMarketAddress,
}: PaperTrailTarget): Promise<void> {
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
      ...byName("MarketResolved").map((log) => ({
        amounts: {},
        fields: {
          kind: "resolved",
          winningSide: contractSideToMarketSide(
            (log.args as { side: number }).side,
          ),
        },
        key: logKey(log),
      })),
      ...byName("MarketCancelled").map((log) => ({
        amounts: {},
        fields: { kind: "cancelled", winningSide: null },
        key: logKey(log),
      })),
    ],
    resolutionRows.map((row) => ({
      amounts: {},
      fields: { kind: row.kind, winningSide: row.winningSide },
      key: rowKey(row),
    })),
  );

  const minted = byName("CompleteSetsMinted");
  const merged = byName("CompleteSetsMerged");
  const completeSetRows = await db
    .select()
    .from(schema.completeSetEvents)
    .where(
      and(
        eq(schema.completeSetEvents.chainId, chainId),
        eq(schema.completeSetEvents.marketId, marketId),
      ),
    );
  // `account` is the payer for both kinds (mint attributes the caller, not
  // the recipient); the sponsored-mint recipient mapping is owned by the
  // handler's own unit tests.
  reconcile(
    failures,
    "complete_set_events",
    [
      ...minted.map((log) => ({
        amounts: pickAmounts(log, ["collateralAmount", "outcomeAmount"]),
        fields: {
          account: (log.args as { caller: string }).caller.toLowerCase(),
          kind: "minted",
        },
        key: logKey(log),
      })),
      ...merged.map((log) => ({
        amounts: pickAmounts(log, ["collateralAmount", "outcomeAmount"]),
        fields: {
          account: (log.args as { account: string }).account.toLowerCase(),
          kind: "merged",
        },
        key: logKey(log),
      })),
    ],
    completeSetRows.map((row) => ({
      amounts: {
        collateralAmount: row.collateralAmount,
        outcomeAmount: row.outcomeAmount,
      },
      fields: { account: row.account.toLowerCase(), kind: row.kind },
      key: rowKey(row),
    })),
  );

  await reconcileOutcomeTokenTransfers({
    createdBlock,
    failures,
    postgradMarketAddress,
  });

  // RetainedCollateralFunded (clearing collateral moving in at graduation)
  // has no dedicated event table; it participates only in this conservation
  // bound: collateral redeemed out can never exceed what verifiably moved in.
  const collateralIn =
    sumArg(byName("RetainedCollateralFunded"), "collateralAmount") +
    sumArg(minted, "collateralAmount") -
    sumArg(merged, "collateralAmount");
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
 * Every ERC-20 Transfer on the market's YES/NO outcome tokens must have
 * exactly one `outcome_token_transfer_events` row — this is the source feed
 * for held balances (portfolio data design D1), so a dropped transfer means
 * a wrong portfolio.
 */
async function reconcileOutcomeTokenTransfers({
  createdBlock,
  failures,
  postgradMarketAddress,
}: {
  createdBlock: bigint;
  failures: string[];
  postgradMarketAddress: Address;
}): Promise<void> {
  const [yesToken, noToken] = (await Promise.all([
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "yesToken",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "noToken",
    }),
  ])) as [Address, Address];

  const transferLogs = await publicClient.getContractEvents({
    abi: outcomeTokenAbi,
    address: [yesToken, noToken],
    eventName: "Transfer",
    fromBlock: createdBlock,
  });
  const rows = await db
    .select()
    .from(schema.outcomeTokenTransferEvents)
    .where(
      and(
        eq(schema.outcomeTokenTransferEvents.chainId, chainId),
        inArray(schema.outcomeTokenTransferEvents.outcomeToken, [
          yesToken.toLowerCase(),
          noToken.toLowerCase(),
        ]),
      ),
    );

  reconcile(
    failures,
    "outcome_token_transfer_events",
    transferLogs.map((log) => {
      const args = log.args as { from: string; to: string; value: bigint };
      return {
        amounts: { value: args.value },
        fields: {
          fromAddress: args.from.toLowerCase(),
          outcomeToken: log.address.toLowerCase(),
          toAddress: args.to.toLowerCase(),
        },
        key: logKey(log),
      };
    }),
    rows.map((row) => ({
      amounts: { value: row.value },
      fields: {
        fromAddress: row.fromAddress.toLowerCase(),
        outcomeToken: row.outcomeToken.toLowerCase(),
        toAddress: row.toAddress.toLowerCase(),
      },
      key: rowKey(row),
    })),
  );
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

    for (const [field, chainValue] of Object.entries(chainEntry.fields ?? {})) {
      const dbValue = dbEntry.fields?.[field];
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

type MoneyEventLog = {
  args: unknown;
  logIndex: number;
  transactionHash: `0x${string}`;
};

function toEntries(
  logs: readonly MoneyEventLog[],
  amountFields: readonly string[],
): LedgerEntry[] {
  return logs.map((log) => ({
    amounts: pickAmounts(log, amountFields),
    key: logKey(log),
  }));
}

function pickAmounts(
  log: MoneyEventLog,
  amountFields: readonly string[],
): Record<string, bigint> {
  const args = log.args as Record<string, bigint>;
  const amounts: Record<string, bigint> = {};

  for (const field of amountFields) {
    const value = args[field];
    if (value === undefined) {
      throw new Error(
        `Expected event field ${field} missing on log ${logKey(log)}`,
      );
    }
    amounts[field] = value;
  }

  return amounts;
}

function logKey(log: {
  logIndex: number;
  transactionHash: `0x${string}`;
}): string {
  return `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
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
