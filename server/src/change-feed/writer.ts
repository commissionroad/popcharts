import { db, schema } from "src/db/client";

import type { ChangeFeedOp, ChangeFeedSourceTable } from "./sources";

/**
 * A database handle that can insert a `change_feed` row — either the process
 * `db` or, far more commonly, the transaction the owning write already opened.
 * Passing the enclosing `tx` is what makes the signal atomic with the change:
 * if the transaction rolls back (e.g. the `MarketNotIndexedError` retry path),
 * the `change_feed` row rolls back with it.
 */
export type LiveChangeWriter =
  typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * One viewer-facing change to signal. The caller (a persistence seam) names its
 * `sourceTable` explicitly — typed as a registered source, so a table with no
 * route is a compile error, not a silently dropped signal — and passes the
 * routing/versioning columns it already has in hand for the underlying write.
 */
export interface LiveChange {
  sourceTable: ChangeFeedSourceTable;
  op: ChangeFeedOp;
  chainId: number;
  /** bigint from an event record or a string; stored as text. */
  marketId?: bigint | string | null;
  /** The holder for `owner`-routed sources; folds the redemption `account`. */
  owner?: string | null;
  /** Primary key of the changed row — diagnostic only, not used for routing. */
  rowId?: bigint | number | string | null;
  blockNumber?: bigint | null;
  logIndex?: number | null;
}

function toRow(change: LiveChange) {
  return {
    sourceTable: change.sourceTable,
    op: change.op,
    rowId: change.rowId == null ? null : String(change.rowId),
    chainId: change.chainId,
    marketId: change.marketId == null ? null : String(change.marketId),
    owner: change.owner ?? null,
    blockNumber: change.blockNumber ?? null,
    logIndex: change.logIndex ?? null,
  };
}

/**
 * Appends a single `change_feed` row in the SAME transaction as the write it
 * signals — the explicit, in-TypeScript replacement for the old capture trigger
 * (repo ADR 0021). Call it at the end of a persistence seam's transaction, on
 * the branch that actually commits a new row, so the feed row exists if and only
 * if the change does. Routing to SSE channels stays in the relay via
 * `CHANGE_FEED_SOURCES[sourceTable]`; this only records the raw signal.
 */
export async function recordLiveChange(
  writer: LiveChangeWriter,
  change: LiveChange,
): Promise<void> {
  await writer.insert(schema.changeFeed).values(toRow(change));
}
