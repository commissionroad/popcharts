import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import type { ReviewBondEventKind } from "src/db/schema/review-bond-events";
import { logValueRequirer } from "src/indexer/utils/log-values";

const requireValue = logValueRequirer("Review bond log");

export type { ReviewBondEventKind };

export type ReviewBondDepositedLog = Log & {
  args: {
    user?: string;
    amount?: bigint;
    totalDeposited?: bigint;
  };
};

export type ReviewFeesSettledLog = Log & {
  args: {
    user?: string;
    consumedDelta?: bigint;
    consumedTotal?: bigint;
  };
};

export type ReviewBondWithdrawnLog = Log & {
  args: {
    user?: string;
    amount?: bigint;
    remainingAvailable?: bigint;
  };
};

export type ReviewFeesWithdrawnLog = Log & {
  args: {
    recipient?: string;
    amount?: bigint;
  };
};

export type ReviewBondLog =
  | ReviewBondDepositedLog
  | ReviewFeesSettledLog
  | ReviewBondWithdrawnLog
  | ReviewFeesWithdrawnLog;

export type ReviewBondRecord = {
  event: typeof schema.reviewBondEvents.$inferInsert;
};

/**
 * Maps a ReviewBondDeposited / ReviewFeesSettled / ReviewBondWithdrawn /
 * ReviewFeesWithdrawn log from the ReviewBondVault into a raw event row — the
 * money paper trail for the review bond (ADR 0022,
 * docs/portfolio-data-design.md). `account` is the bonded user for the first
 * three kinds and the sweep recipient for `fees_withdrawn`; `runningTotal`
 * carries the event's own cumulative figure (lifetime deposits, lifetime
 * settled consumption, remaining available bond; null for fee sweeps, which
 * report no cumulative on-chain).
 */
export function buildReviewBondRecord({
  blockTimestamp,
  config,
  contractId,
  kind,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  kind: ReviewBondEventKind;
  log: ReviewBondLog;
}): ReviewBondRecord {
  const base = {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    kind,
    logIndex: requireValue(log.logIndex, "logIndex"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };

  if (kind === "fees_withdrawn") {
    const swept = log as ReviewFeesWithdrawnLog;

    return {
      event: {
        ...base,
        account: requireValue(swept.args.recipient, "recipient").toLowerCase(),
        amount: requireValue(swept.args.amount, "amount"),
        runningTotal: null,
      },
    };
  }

  // The three user-scoped kinds all key on the indexed `user`.
  const account = requireValue(
    (log as ReviewBondDepositedLog).args.user,
    "user",
  ).toLowerCase();

  if (kind === "settled") {
    const settled = log as ReviewFeesSettledLog;

    return {
      event: {
        ...base,
        account,
        amount: requireValue(settled.args.consumedDelta, "consumedDelta"),
        runningTotal: requireValue(settled.args.consumedTotal, "consumedTotal"),
      },
    };
  }

  if (kind === "deposited") {
    const deposited = log as ReviewBondDepositedLog;

    return {
      event: {
        ...base,
        account,
        amount: requireValue(deposited.args.amount, "amount"),
        runningTotal: requireValue(
          deposited.args.totalDeposited,
          "totalDeposited",
        ),
      },
    };
  }

  const withdrawn = log as ReviewBondWithdrawnLog;

  return {
    event: {
      ...base,
      account,
      amount: requireValue(withdrawn.args.amount, "amount"),
      runningTotal: requireValue(
        withdrawn.args.remainingAvailable,
        "remainingAvailable",
      ),
    },
  };
}

/**
 * Persists the raw vault-movement row. Append-only and deduped on
 * (chain, tx, log): the review-bond meter reconciles against each event's own
 * `runningTotal`, so there is no projection to update, and a replay can never
 * double-count a value transfer. Deliberately no change-feed signal:
 * review_bond_events is not a registered live-update source — the bond meter
 * is an on-demand read with no live product surface, and registering a route
 * belongs to whichever build adds that surface.
 */
export async function persistReviewBondRecord(
  record: ReviewBondRecord,
  dbc: typeof db = db,
) {
  await dbc
    .insert(schema.reviewBondEvents)
    .values(record.event)
    .onConflictDoNothing();
}
