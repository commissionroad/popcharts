import {
  contractSideToMarketSide,
  SIDE_NO,
  SIDE_YES,
  type MarketSide,
} from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, and, eq, inArray, schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
import type { PostgradDisputeKind } from "src/db/schema/postgrad-dispute-events";
import { unixSecondsToDate } from "src/indexer/utils/unix-seconds";
import { recordLiveChange } from "src/change-feed/writer";

export type { PostgradDisputeKind };

export type PostgradResolutionProposedLog = Log & {
  args: {
    /** MarketTypes.Side; decode via contractSideToMarketSide. */
    side?: number;
    /** Unix seconds at which the dispute window closes. */
    disputeDeadline?: bigint;
  };
};

export type PostgradResolutionDisputedLog = Log & {
  args: {
    disputer?: string;
    /**
     * Bond escrowed by the dispute. Deliberately not read here: the same
     * transaction emits DisputeBondPosted, and that is the money paper-trail
     * record (postgrad_dispute_bond_events).
     */
    bond?: bigint;
  };
};

export type PostgradDisputeRecord = {
  event: typeof schema.postgradDisputeEvents.$inferInsert;
};

/**
 * Maps a ResolutionProposed/ResolutionDisputed log from a graduated
 * CompleteSetBinaryMarket into a raw event row (repo ADR 0024). Like the
 * terminal resolution handler, the market contract emits no marketId — the
 * address identifies the market, resolved to the pregrad marketId through the
 * postgrad-market registry by the caller.
 */
export function buildPostgradDisputeRecord({
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
  kind: PostgradDisputeKind;
  log: PostgradResolutionDisputedLog | PostgradResolutionProposedLog;
  marketId: bigint;
}): PostgradDisputeRecord {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");

  const base = {
    blockNumber,
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    kind,
    logIndex,
    marketId,
    postgradMarket: log.address.toLowerCase(),
    transactionHash,
  };

  if (kind === "proposed") {
    const proposed = log as PostgradResolutionProposedLog;
    const side: MarketSide = contractSideToMarketSide(
      requireContractSide(requireValue(proposed.args.side, "side")),
    );

    return {
      event: {
        ...base,
        disputeDeadline: unixSecondsToDate(
          requireValue(proposed.args.disputeDeadline, "disputeDeadline"),
        ),
        disputer: null,
        proposedSide: side,
      },
    };
  }

  const disputed = log as PostgradResolutionDisputedLog;

  return {
    event: {
      ...base,
      disputeDeadline: null,
      disputer: requireValue(disputed.args.disputer, "disputer").toLowerCase(),
      proposedSide: null,
    },
  };
}

/**
 * The status a dispute-lifecycle row moves the market into, and the statuses it
 * accepts as predecessors. Guarding on the predecessor keeps a replayed or
 * out-of-order log from dragging a market backwards out of a status another
 * authority has already advanced past.
 *
 * `disputed` accepts `graduated` as well as `resolution_pending` because a
 * dispute log *implies* its proposal: `dispute()` reverts unless the market is
 * already ResolutionPending on chain, so a market reading `graduated` when a
 * dispute arrives means only that the proposal log has not been applied yet —
 * a recovery sweep and the live subscription racing on a market discovered
 * mid-window. Accepting it makes the projection right either way: the
 * late-arriving proposal then finds the market in `disputed`, matches none of
 * its own predecessors, and no-ops, leaving the correct status rather than a
 * countdown that will never finalize. `resolved` and `cancelled` stay out of
 * both sets, so no dispute can pull a terminal market back into the window.
 */
const DISPUTE_TRANSITIONS = {
  proposed: {
    from: ["graduated"] as const satisfies readonly MarketStatus[],
    to: "resolution_pending",
  },
  disputed: {
    from: [
      "resolution_pending",
      "graduated",
    ] as const satisfies readonly MarketStatus[],
    to: "disputed",
  },
} as const satisfies Record<
  PostgradDisputeKind,
  { from: readonly MarketStatus[]; to: MarketStatus }
>;

/**
 * Persists the raw dispute-lifecycle row and advances the markets projection
 * into `resolution_pending`/`disputed`. The event insert dedupes on
 * (chain, tx, log), and the projection update is guarded on the predecessor
 * status, so replays are no-ops and a market that already resolved is never
 * pulled back into the window.
 */
export async function persistPostgradDisputeRecord(
  record: PostgradDisputeRecord,
  dbc: typeof db = db,
) {
  const transition = DISPUTE_TRANSITIONS[record.event.kind];

  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.postgradDisputeEvents)
      .values(record.event)
      .onConflictDoNothing()
      .returning({ id: schema.postgradDisputeEvents.id });

    // A conflict means this exact log was already processed (recovery replay
    // or a second indexer); the projection was handled the first time.
    if (inserted.length === 0) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        status: transition.to,
        updatedAt: record.event.blockTimestamp,
      })
      .where(
        and(
          eq(schema.markets.chainId, record.event.chainId),
          eq(schema.markets.marketId, record.event.marketId),
          inArray(schema.markets.status, [...transition.from]),
        ),
      );

    await recordLiveChange(tx, {
      sourceTable: "postgrad_dispute_events",
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
    throw new Error(`Postgrad dispute log is missing ${name}.`);
  }

  return value;
}

/**
 * Rejects anything that is not a MarketTypes.Side member. The shared
 * contractSideToMarketSide decodes every non-YES value as NO, which is the
 * right default for a value the chain guarantees is in range — but a proposal
 * is the input to a money-moving outcome, so a decode that produced 2 (ABI
 * drift, a corrupted log) must stop the cursor rather than record a real,
 * plausible-looking NO proposal.
 */
function requireContractSide(side: number): number {
  if (side !== SIDE_YES && side !== SIDE_NO) {
    throw new Error(
      `Postgrad dispute log has an out-of-range MarketTypes.Side value ${side}.`,
    );
  }

  return side;
}
