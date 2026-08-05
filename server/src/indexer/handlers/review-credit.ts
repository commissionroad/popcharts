import type { Log } from "viem";

import { recordLiveChange } from "src/change-feed/writer";
import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import type { ReviewCreditEventKind } from "src/db/schema/review-credit-events";
import { logValueRequirer } from "src/indexer/utils/log-values";

const requireValue = logValueRequirer("Review credit log");

export type { ReviewCreditEventKind };

export type ReviewCreditDepositedLog = Log & {
  args: {
    user?: string;
    payer?: string;
    amount?: bigint;
    totalDeposited?: bigint;
  };
};

export type ReviewFeesWithdrawnLog = Log & {
  args: {
    recipient?: string;
    amount?: bigint;
  };
};

export type ReviewCreditLog = ReviewCreditDepositedLog | ReviewFeesWithdrawnLog;

export type ReviewCreditRecord = {
  event: typeof schema.reviewCreditEvents.$inferInsert;
};

/**
 * Maps a ReviewCreditDeposited / ReviewFeesWithdrawn log from the vault into a
 * raw event row — the money paper trail for prepaid review credit (ADR 0022's
 * prepaid-credit amendment, docs/portfolio-data-design.md). `account` is the
 * credited beneficiary for deposits and the sweep recipient for
 * `fees_withdrawn`; `payer` is the wallet that actually sent a deposit (null
 * for sweeps); `runningTotal` carries the deposit's own cumulative lifetime
 * figure (null for sweeps, which report no cumulative on-chain). The retired
 * `settled` / `bond_withdrawn` kinds are no longer emitted by the contract.
 */
export function buildReviewCreditRecord({
  blockTimestamp,
  config,
  contractId,
  kind,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  kind: ReviewCreditEventKind;
  log: ReviewCreditLog;
}): ReviewCreditRecord {
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
        payer: null,
        runningTotal: null,
      },
    };
  }

  const deposited = log as ReviewCreditDepositedLog;

  return {
    event: {
      ...base,
      account: requireValue(deposited.args.user, "user").toLowerCase(),
      amount: requireValue(deposited.args.amount, "amount"),
      payer: requireValue(deposited.args.payer, "payer").toLowerCase(),
      runningTotal: requireValue(
        deposited.args.totalDeposited,
        "totalDeposited",
      ),
    },
  };
}

/**
 * Persists the raw vault-movement row. Append-only and deduped on
 * (chain, tx, log): the credit meter sums deposit rows directly, so a replay
 * can never double-count a value transfer.
 *
 * A deposit also signals the change feed on the beneficiary's portfolio
 * channel, in the same transaction as the row: the submission gate reads
 * credit from these indexed rows (never the chain), so a depositor is refused
 * until this insert lands — the signal is what turns "refused, deposit,
 * notified, resubmit" into a flow instead of a page refresh. Sweeps move no
 * user-facing value and stay silent.
 */
export async function persistReviewCreditRecord(
  record: ReviewCreditRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.reviewCreditEvents)
      .values(record.event)
      .onConflictDoNothing()
      .returning({ id: schema.reviewCreditEvents.id });

    if (inserted.length === 0 || record.event.kind !== "deposited") {
      return;
    }

    await recordLiveChange(tx, {
      sourceTable: "review_bond_events",
      op: "insert",
      chainId: record.event.chainId,
      marketId: null,
      owner: record.event.account,
      rowId: inserted[0].id,
      blockNumber: record.event.blockNumber,
      logIndex: record.event.logIndex,
    });
  });
}
