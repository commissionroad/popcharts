import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import type { PostgradDisputeBondKind } from "src/db/schema/postgrad-dispute-bond-events";

export type { PostgradDisputeBondKind };

/**
 * DisputeBondPosted/Refunded/Forfeited all carry the same (disputer, amount)
 * pair, so one log shape serves all three kinds.
 */
export type PostgradDisputeBondLog = Log & {
  args: {
    disputer?: string;
    amount?: bigint;
  };
};

export type PostgradDisputeBondRecord = {
  event: typeof schema.postgradDisputeBondEvents.$inferInsert;
};

/**
 * Maps a DisputeBondPosted/Refunded/Forfeited log from a graduated
 * CompleteSetBinaryMarket into a raw event row — the money paper trail for the
 * dispute bond (docs/portfolio-data-design.md, repo ADR 0024). The kind, not
 * the payload, carries the direction the collateral moved.
 */
export function buildPostgradDisputeBondRecord({
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
  kind: PostgradDisputeBondKind;
  log: PostgradDisputeBondLog;
  marketId: bigint;
}): PostgradDisputeBondRecord {
  return {
    event: {
      amount: requireValue(log.args.amount, "amount"),
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      disputer: requireValue(log.args.disputer, "disputer").toLowerCase(),
      kind,
      logIndex: requireValue(log.logIndex, "logIndex"),
      marketId,
      postgradMarket: log.address.toLowerCase(),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/**
 * Persists the raw bond-movement row. Append-only and deduped on
 * (chain, tx, log): the bond balance is derivable from the kind sequence, so
 * there is no projection to update, and a replay can never double-count a
 * value transfer.
 */
export async function persistPostgradDisputeBondRecord(
  record: PostgradDisputeBondRecord,
  dbc: typeof db = db,
) {
  await dbc
    .insert(schema.postgradDisputeBondEvents)
    .values(record.event)
    .onConflictDoNothing();
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Postgrad dispute bond log is missing ${name}.`);
  }

  return value;
}
