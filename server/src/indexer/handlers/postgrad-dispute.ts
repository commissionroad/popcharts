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
import { unixSecondsToDate } from "src/indexer/utils/unix-seconds";

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
 * Persists the raw dispute-lifecycle row. Append-only and deduped on
 * (chain, tx, log), so a recovery replay or a second indexer re-walking the
 * market never double-records a proposal or a dispute.
 */
export async function persistPostgradDisputeRecord(
  record: PostgradDisputeRecord,
  dbc: typeof db = db,
) {
  await dbc
    .insert(schema.postgradDisputeEvents)
    .values(record.event)
    .onConflictDoNothing();
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
