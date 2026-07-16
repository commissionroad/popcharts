import { contractSideToMarketSide } from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";

export type PostgradRedemptionKind = "redeemed" | "cancelled_redeemed";

export type PostgradRedeemedLog = Log & {
  args: {
    account?: string;
    /** MarketTypes.Side; decode via contractSideToMarketSide. */
    side?: number;
    outcomeAmount?: bigint;
    collateralAmount?: bigint;
  };
};

export type PostgradCancelledRedeemedLog = Log & {
  args: {
    account?: string;
    yesAmount?: bigint;
    noAmount?: bigint;
    collateralAmount?: bigint;
  };
};

export type PostgradRedemptionRecord = {
  event: typeof schema.postgradRedemptionEvents.$inferInsert;
};

/**
 * Maps a Redeemed/CancelledRedeemed log from a graduated
 * CompleteSetBinaryMarket into a raw event row — the money paper trail for a
 * redemption payout (docs/portfolio-data-design.md). Like the resolution
 * handler, the market contract emits no marketId; the address identifies the
 * market, resolved through the postgrad-market registry by the caller.
 */
export function buildPostgradRedemptionRecord({
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
  kind: PostgradRedemptionKind;
  log: PostgradCancelledRedeemedLog | PostgradRedeemedLog;
  marketId: bigint;
}): PostgradRedemptionRecord {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");
  const account = requireValue(
    (log as PostgradRedeemedLog).args.account,
    "account",
  ).toLowerCase();
  const collateralAmount = requireValue(
    (log as PostgradRedeemedLog).args.collateralAmount,
    "collateralAmount",
  );

  const base = {
    account,
    blockNumber,
    blockTimestamp,
    chainId: config.chainId,
    collateralAmount,
    contractId,
    kind,
    logIndex,
    marketId,
    postgradMarket: log.address.toLowerCase(),
    transactionHash,
  };

  if (kind === "redeemed") {
    const redeemed = log as PostgradRedeemedLog;
    const side = requireValue(redeemed.args.side, "side");

    return {
      event: {
        ...base,
        noAmount: null,
        outcomeAmount: requireValue(
          redeemed.args.outcomeAmount,
          "outcomeAmount",
        ),
        side: contractSideToMarketSide(side),
        yesAmount: null,
      },
    };
  }

  const cancelled = log as PostgradCancelledRedeemedLog;

  return {
    event: {
      ...base,
      noAmount: requireValue(cancelled.args.noAmount, "noAmount"),
      outcomeAmount: null,
      side: null,
      yesAmount: requireValue(cancelled.args.yesAmount, "yesAmount"),
    },
  };
}

/**
 * Persists the raw redemption row. Append-only: the wallet's balance change is
 * projected independently from the outcome-token Transfer stream, so there is
 * no projection to update here. The insert dedupes on (chain, tx, log) so a
 * recovery replay or a second indexer never double-records a payout.
 */
export async function persistPostgradRedemptionRecord(
  record: PostgradRedemptionRecord,
) {
  await db
    .insert(schema.postgradRedemptionEvents)
    .values(record.event)
    .onConflictDoNothing();
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Postgrad redemption log is missing ${name}.`);
  }

  return value;
}
