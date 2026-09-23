import { computeMatchedMarketCap, SIDE_YES } from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { and, db, eq, schema, sql } from "src/db/client";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";
import { buildPriceTick } from "src/change-feed/receipt-price-tick";
import { recordLiveChange } from "src/change-feed/writer";
import { logValueRequirer } from "src/indexer/utils/log-values";

const requireValue = logValueRequirer("ReceiptPlaced log");

export type ReceiptPlacedLog = Log & {
  args: {
    cost?: bigint;
    marketId?: bigint;
    owner?: `0x${string}`;
    rHigh?: bigint;
    rLow?: bigint;
    receiptId?: bigint;
    sequence?: bigint;
    shares?: bigint;
    /** MarketTypes.Side; compare against SIDE_YES/SIDE_NO. */
    side?: number;
  };
};

export type ReceiptPlacedRecord =
  typeof schema.receiptPlacedEvents.$inferInsert;

export function buildReceiptPlacedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: ReceiptPlacedLog;
}): ReceiptPlacedRecord {
  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    cost: requireValue(log.args.cost, "cost"),
    logIndex: requireValue(log.logIndex, "logIndex"),
    marketId: requireValue(log.args.marketId, "marketId"),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    rHigh: requireValue(log.args.rHigh, "rHigh").toString(),
    rLow: requireValue(log.args.rLow, "rLow").toString(),
    receiptId: requireValue(log.args.receiptId, "receiptId"),
    sequence: requireValue(log.args.sequence, "sequence"),
    shares: requireValue(log.args.shares, "shares"),
    side: requireValue(log.args.side, "side"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

export async function persistReceiptPlacedRecord(
  record: ReceiptPlacedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const costIncrement = record.cost.toString();
    const sharesIncrement = record.shares.toString();
    const inserted = await tx
      .insert(schema.receiptPlacedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.receiptPlacedEvents.id });

    if (!inserted[0]) {
      return;
    }

    const marketWhere = and(
      eq(schema.markets.chainId, record.chainId),
      eq(schema.markets.marketId, record.marketId),
    );
    // The post-trade share balances + static curve params: exactly the inputs
    // the price tick needs.
    const tickInputs = {
      id: schema.markets.id,
      liquidityParameter: schema.markets.liquidityParameter,
      noShares: schema.markets.noShares,
      openingProbabilityWad: schema.markets.openingProbabilityWad,
      totalEscrowed: schema.markets.totalEscrowed,
      yesShares: schema.markets.yesShares,
    };

    // Lock the projection before deciding whether this receipt still moves
    // it, so a GraduationStarted write cannot land between that decision and
    // the increment below. The graduation handler updates the same row, so
    // whichever transaction takes the lock second sees the other's commit.
    const [locked] = await tx
      .select({ id: schema.markets.id })
      .from(schema.markets)
      .where(marketWhere)
      .for("update");

    // Roll back the event insert too: committing it without the markets
    // projection would make the onConflictDoNothing dedup skip the counter
    // updates on every future replay of this receipt.
    if (!locked) {
      throw new MarketNotIndexedError(record);
    }

    const [market] = (await hasGraduationSnapshot(tx, record))
      ? // GraduationStarted already wrote the chain's absolute totals, and
        // placeReceipt requires an Active market, so that snapshot counts
        // every receipt the market will ever take — this one included.
        // Adding it again would double-count it. It happens whenever this
        // receipt is indexed after the snapshot: the settlement and receipt
        // watchers run independently, and the dev graduation endpoint mirrors
        // settlement logs itself.
        await tx.select(tickInputs).from(schema.markets).where(marketWhere)
      : await tx
          .update(schema.markets)
          .set({
            receiptCount: record.sequence,
            totalEscrowed: sql`${schema.markets.totalEscrowed} + ${costIncrement}::numeric(78, 0)`,
            updatedAt: new Date(),
            ...(record.side === SIDE_YES
              ? {
                  yesShares: sql`${schema.markets.yesShares} + ${sharesIncrement}::numeric(78, 0)`,
                }
              : {
                  noShares: sql`${schema.markets.noShares} + ${sharesIncrement}::numeric(78, 0)`,
                }),
          })
          .where(marketWhere)
          .returning(tickInputs);

    if (!market) {
      throw new MarketNotIndexedError(record);
    }

    // The band-pass matched cap after this receipt, folded over the market's
    // whole book — the same O(receipts) computation every market read already
    // performs (loadMatchedMarketCaps), so the trade path costs what a read
    // costs. Includes the receipt inserted above: same transaction, so the
    // select sees it. If receipt books outgrow this fold it has to become an
    // incremental band aggregate — on the read path first, this call second.
    const bookRows = await tx
      .select({
        rHigh: schema.receiptPlacedEvents.rHigh,
        rLow: schema.receiptPlacedEvents.rLow,
        side: schema.receiptPlacedEvents.side,
      })
      .from(schema.receiptPlacedEvents)
      .where(
        and(
          eq(schema.receiptPlacedEvents.chainId, record.chainId),
          eq(schema.receiptPlacedEvents.marketId, record.marketId),
        ),
      );
    const matchedMarketCapWad = computeMatchedMarketCap(
      bookRows.map((row) => ({
        rHigh: BigInt(row.rHigh),
        rLow: BigInt(row.rLow),
        side: row.side,
      })),
    );

    // Signal the price/chart/graduation bar and the bettor's portfolio, atomic
    // with the receipt+counter writes above. The tick rides the frame so the
    // chart appends this point rather than replaying the whole history.
    await recordLiveChange(tx, {
      sourceTable: "receipt_placed_events",
      op: "insert",
      chainId: record.chainId,
      marketId: record.marketId,
      owner: record.owner,
      rowId: inserted[0].id,
      blockNumber: record.blockNumber,
      logIndex: record.logIndex,
      tick: buildPriceTick({
        t: record.blockTimestamp,
        sequence: record.sequence,
        liquidityParameterWad: market.liquidityParameter,
        openingProbabilityWad: market.openingProbabilityWad,
        yesSharesWad: market.yesShares,
        noSharesWad: market.noShares,
        matchedMarketCapWad,
        totalEscrowedWad: market.totalEscrowed,
      }),
    });
  });
}

/** Whether GraduationStarted has already frozen this market's totals. */
async function hasGraduationSnapshot(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  record: ReceiptPlacedRecord,
): Promise<boolean> {
  const [snapshot] = await tx
    .select({ id: schema.graduationStartedEvents.id })
    .from(schema.graduationStartedEvents)
    .where(
      and(
        eq(schema.graduationStartedEvents.chainId, record.chainId),
        eq(schema.graduationStartedEvents.marketId, record.marketId),
      ),
    )
    .limit(1);

  return snapshot !== undefined;
}
