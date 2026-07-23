import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";

import type { CompleteSetKind } from "src/db/schema/complete-set-events";

export type CompleteSetsMintedLog = Log & {
  args: {
    caller?: string;
    to?: string;
    collateralAmount?: bigint;
    outcomeAmount?: bigint;
  };
};

export type CompleteSetsMergedLog = Log & {
  args: {
    account?: string;
    collateralAmount?: bigint;
    outcomeAmount?: bigint;
  };
};

export type CompleteSetEventRecord = {
  event: typeof schema.completeSetEvents.$inferInsert;
};

/**
 * Maps a CompleteSetsMinted/CompleteSetsMerged log from a graduated
 * CompleteSetBinaryMarket into a raw event row — the money paper trail for
 * collateral entering (mint) or leaving (merge) the market
 * (docs/portfolio-data-design.md). Like the other postgrad-market handlers,
 * the contract emits no marketId; the address identifies the market, resolved
 * through the postgrad-market registry by the caller. `account` is the wallet
 * whose collateral moved — mintCompleteSets pulls collateral from its caller
 * (msg.sender) and mergeCompleteSets pays msg.sender, so mint rows attribute
 * to the payer, not the token recipient; a sponsored mint's `to` is kept as
 * `recipient` only when it differs from the payer.
 */
export function buildCompleteSetEventRecord({
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
  kind: CompleteSetKind;
  log: CompleteSetsMergedLog | CompleteSetsMintedLog;
  marketId: bigint;
}): CompleteSetEventRecord {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");
  const collateralAmount = requireValue(
    log.args.collateralAmount,
    "collateralAmount",
  );
  const outcomeAmount = requireValue(log.args.outcomeAmount, "outcomeAmount");

  let account: string;
  let recipient: string | null;

  if (kind === "minted") {
    const minted = log as CompleteSetsMintedLog;
    account = requireValue(minted.args.caller, "caller").toLowerCase();
    const mintRecipient = requireValue(minted.args.to, "to").toLowerCase();
    recipient = mintRecipient === account ? null : mintRecipient;
  } else {
    const merged = log as CompleteSetsMergedLog;
    account = requireValue(merged.args.account, "account").toLowerCase();
    recipient = null;
  }

  return {
    event: {
      account,
      blockNumber,
      blockTimestamp,
      chainId: config.chainId,
      collateralAmount,
      contractId,
      kind,
      logIndex,
      marketId,
      outcomeAmount,
      postgradMarket: log.address.toLowerCase(),
      recipient,
      transactionHash,
    },
  };
}

/**
 * Persists the raw complete-set row. Append-only: the wallet's token balance
 * change is projected independently from the outcome-token Transfer stream,
 * so there is no projection to update here. The insert dedupes on (chain, tx,
 * log) so a recovery replay or a second indexer never double-records a mint
 * or merge.
 */
export async function persistCompleteSetEventRecord(
  record: CompleteSetEventRecord,
) {
  await db
    .insert(schema.completeSetEvents)
    .values(record.event)
    .onConflictDoNothing();
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Complete-set log is missing ${name}.`);
  }

  return value;
}
