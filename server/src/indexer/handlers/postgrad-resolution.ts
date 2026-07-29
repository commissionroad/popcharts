import { contractSideToMarketSide, type MarketSide } from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
import type { PostgradResolutionKind } from "src/db/schema/postgrad-resolution-events";
import { applyMarketStatusTransition } from "src/indexer/handlers/market-projection";
import { recordLiveChange } from "src/change-feed/writer";
import { logValueRequirer } from "src/indexer/utils/log-values";

const requireValue = logValueRequirer("Postgrad resolution log");

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
 * The statuses a market may hold when its terminal resolution lands. Beyond
 * the direct `graduated` → resolved path (a zero dispute window, and every
 * market created before repo ADR 0024), a market can resolve out of the
 * dispute window: `resolution_pending` when a proposal finalizes, `disputed`
 * when an operator settles a dispute. Narrowing this back to `graduated` alone
 * would silently drop the terminal status of every disputed market.
 */
const RESOLVABLE_STATUSES = [
  "graduated",
  "resolution_pending",
  "disputed",
] as const satisfies readonly MarketStatus[];

/**
 * Both terminal statuses count as "already settled" for either kind: a market
 * that is `cancelled` when a MarketResolved arrives (or the reverse) is a
 * contradiction the chain cannot produce.
 *
 * Do not "tidy" these into the ordering-fault branch for consistency. The
 * postgrad watcher runs ONE cursor for every event family, so a handler that
 * throws forever stops redemptions, complete-set events and bond events for
 * every market — a permanent outage traded for a louder signal about a state
 * that cannot occur. A no-op is the right answer for an impossible input.
 */
const SETTLED_STATUSES = [
  "resolved",
  "cancelled",
] as const satisfies readonly MarketStatus[];

/**
 * Persists the raw event row and flips the markets projection into its
 * terminal resolution status. The event insert dedupes on (chain, tx, log),
 * and the projection is guarded on the market still being in a resolvable
 * status, so a replayed log can never overwrite a status another authority has
 * moved. An arrival from any other status throws rather than committing the
 * raw row with no projection — that combination would lose the terminal status
 * permanently, because every later replay dedupes out before reaching here.
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

    await applyMarketStatusTransition(tx, {
      chainId: record.event.chainId,
      marketId: record.event.marketId,
      transition: {
        atOrPast: SETTLED_STATUSES,
        from: RESOLVABLE_STATUSES,
        to: targetStatus,
      },
      updatedAt: record.event.blockTimestamp,
    });

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
