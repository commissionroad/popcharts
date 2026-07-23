import { contractSideToMarketSide, type MarketSide } from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, and, eq, schema } from "src/db/client";
import type { PostgradResolutionKind } from "src/db/schema/postgrad-resolution-events";
import { recordLiveChange } from "src/change-feed/writer";

export type { PostgradResolutionKind };

export type PostgradMarketResolvedLog = Log & {
  args: {
    /** MarketTypes.Side; decode via contractSideToMarketSide. */
    side?: number;
  };
};

export type PostgradMarketCancelledLog = Log & {
  args: Record<string, never>;
};

export type PostgradResolutionRecord = {
  event: typeof schema.postgradResolutionEvents.$inferInsert;
};

/**
 * Maps a MarketResolved/MarketCancelled log from a graduated
 * CompleteSetBinaryMarket into a raw event row. The market contract emits no
 * marketId — the address itself identifies the market, resolved to the pregrad
 * marketId through the postgrad-market registry by the caller.
 */
export function buildPostgradResolutionRecord({
  blockTimestamp,
  config,
  contractId,
  kind,
  log,
  marketId,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  kind: PostgradResolutionKind;
  log: PostgradMarketCancelledLog | PostgradMarketResolvedLog;
  marketId: bigint;
}): PostgradResolutionRecord {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");

  let winningSide: MarketSide | null = null;
  if (kind === "resolved") {
    const side = requireValue(
      (log as PostgradMarketResolvedLog).args.side,
      "side",
    );
    winningSide = contractSideToMarketSide(side);
  }

  return {
    event: {
      blockNumber,
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      kind,
      logIndex,
      marketId,
      postgradMarket: log.address.toLowerCase(),
      transactionHash,
      winningSide,
    },
  };
}

/**
 * Persists the raw event row and flips the markets projection into its
 * terminal resolution status. The event insert dedupes on (chain, tx, log),
 * and the projection update is guarded on status='graduated' so a replayed or
 * out-of-order log can never overwrite a status another authority has moved.
 */
export async function persistPostgradResolutionRecord(
  record: PostgradResolutionRecord,
  dbc: typeof db = db,
) {
  const targetStatus =
    record.event.kind === "resolved"
      ? ("resolved" as const)
      : ("cancelled" as const);

  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.postgradResolutionEvents)
      .values(record.event)
      .onConflictDoNothing()
      .returning({ id: schema.postgradResolutionEvents.id });

    // A conflict means this exact log was already processed (recovery replay
    // or a second indexer); the projection was handled the first time.
    if (inserted.length === 0) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        status: targetStatus,
        updatedAt: record.event.blockTimestamp,
      })
      .where(
        and(
          eq(schema.markets.chainId, record.event.chainId),
          eq(schema.markets.marketId, record.event.marketId),
          eq(schema.markets.status, "graduated"),
        ),
      );

    await recordLiveChange(tx, {
      sourceTable: "postgrad_resolution_events",
      op: "insert",
      chainId: record.event.chainId,
      marketId: record.event.marketId,
      rowId: inserted[0].id,
      blockNumber: record.event.blockNumber,
      logIndex: record.event.logIndex,
    });
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Postgrad resolution log is missing ${name}.`);
  }

  return value;
}
