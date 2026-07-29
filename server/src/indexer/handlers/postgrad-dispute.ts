import {
  contractSideToMarketSide,
  SIDE_NO,
  SIDE_YES,
  type MarketSide,
} from "@popcharts/protocol";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import type { PostgradDisputeKind } from "src/db/schema/postgrad-dispute-events";
import {
  applyMarketStatusTransition,
  type MarketStatusTransition,
} from "src/indexer/handlers/market-projection";
import { unixSecondsToDate } from "src/indexer/utils/unix-seconds";
import { recordLiveChange } from "src/change-feed/writer";
import {
  formatOperatorAlert,
  OPERATOR_ALERT_EVENTS,
} from "src/shared/operator-alert-log";

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
     * Bond escrowed by the dispute. Deliberately not persisted here: the same
     * transaction emits DisputeBondPosted, and that is the money paper-trail
     * record (postgrad_dispute_bond_events). It is read only as context on the
     * operator alert, so the page carries the stake without a second lookup.
     */
    bond?: bigint;
  };
};

export type PostgradDisputeRecord = {
  event: typeof schema.postgradDisputeEvents.$inferInsert;
  /**
   * Operator-page line to emit once the event row actually lands. Present only
   * for `disputed`: a dispute freezes the market until a human settles it, so
   * it is an alarm, not a log entry (repo ADR 0024 phase 5).
   */
  operatorAlert?: string;
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
  const disputer = requireValue(
    disputed.args.disputer,
    "disputer",
  ).toLowerCase();

  return {
    event: {
      ...base,
      disputeDeadline: null,
      disputer,
      proposedSide: null,
    },
    operatorAlert: formatOperatorAlert(
      OPERATOR_ALERT_EVENTS.resolutionDisputed,
      {
        // uint256 values render as decimal strings: JSON.stringify throws on
        // bigint, and the raw base units are what an operator reconciles against
        // the bond paper trail.
        bond: requireValue(disputed.args.bond, "bond").toString(),
        chainId: base.chainId,
        disputer,
        marketId: base.marketId.toString(),
        postgradMarket: base.postgradMarket,
        transactionHash: base.transactionHash,
      },
    ),
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
 * late-arriving proposal then finds the market already at or past its target
 * and no-ops, leaving the correct status rather than a countdown that will
 * never finalize. `resolved` and `cancelled` are `atOrPast` for both kinds, so
 * no dispute can pull a terminal market back into the window. Any status
 * outside both sets is an ordering fault and throws — see
 * applyMarketStatusTransition.
 */
const DISPUTE_TRANSITIONS = {
  proposed: {
    atOrPast: ["resolution_pending", "disputed", "resolved", "cancelled"],
    from: ["graduated"],
    to: "resolution_pending",
  },
  disputed: {
    atOrPast: ["disputed", "resolved", "cancelled"],
    from: ["resolution_pending", "graduated"],
    to: "disputed",
  },
} as const satisfies Record<PostgradDisputeKind, MarketStatusTransition>;

/**
 * Persists the raw dispute-lifecycle row, advances the markets projection into
 * `resolution_pending`/`disputed`, and raises the operator page a `disputed`
 * row carries. The event insert dedupes on (chain, tx, log), and the projection
 * is guarded on the predecessor status, so replays are no-ops and a market that
 * already resolved is never pulled back into the window. An arrival from a
 * status in neither set throws rather than committing the raw row with no
 * projection — that combination would lose the transition permanently, because
 * every later replay dedupes out before reaching here. The page follows the
 * same rule: it is raised only for a row that committed with its projection, so
 * a rolled-back ordering fault pages when the retry succeeds, not before.
 */
export async function persistPostgradDisputeRecord(
  record: PostgradDisputeRecord,
  dbc: typeof db = db,
) {
  const transition = DISPUTE_TRANSITIONS[record.event.kind];

  const applied = await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.postgradDisputeEvents)
      .values(record.event)
      .onConflictDoNothing()
      .returning({ id: schema.postgradDisputeEvents.id });

    // A conflict means this exact log was already processed (recovery replay
    // or a second indexer); the projection was handled the first time.
    if (inserted.length === 0) {
      return false;
    }

    await applyMarketStatusTransition(tx, {
      chainId: record.event.chainId,
      marketId: record.event.marketId,
      transition,
      updatedAt: record.event.blockTimestamp,
    });

    await recordLiveChange(tx, {
      sourceTable: "postgrad_dispute_events",
      op: "insert",
      chainId: record.event.chainId,
      marketId: record.event.marketId,
      rowId: inserted[0].id,
      blockNumber: record.event.blockNumber,
      logIndex: record.event.logIndex,
    });

    return true;
  });

  // Raised after the commit and only for a row that actually landed, so a
  // rolled-back write cannot page and a recovery replay of the same log cannot
  // page twice. stderr, because the alarm treats this as an incident.
  if (applied && record.operatorAlert) {
    console.error(record.operatorAlert);
  }
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
