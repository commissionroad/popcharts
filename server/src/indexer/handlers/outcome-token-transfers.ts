import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { ZERO_ADDRESS } from "src/config";
import { db, schema, sql } from "src/db/client";

export type OutcomeTokenTransferLog = Log & {
  args: {
    from?: `0x${string}`;
    to?: `0x${string}`;
    value?: bigint;
  };
};

/**
 * The events-table row plus the market mapping the balance projection
 * denormalizes; marketId/side come from the outcome-token registry, not the
 * log itself.
 */
export type OutcomeTokenTransferRecord =
  typeof schema.outcomeTokenTransferEvents.$inferInsert & {
    marketId: bigint;
    side: "yes" | "no";
  };

type BuildInput = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: OutcomeTokenTransferLog;
  marketId: bigint;
  side: "yes" | "no";
};

/** Maps an outcome-token Transfer log into a typed events-table row. */
export function buildOutcomeTokenTransferRecord(
  input: BuildInput,
): OutcomeTokenTransferRecord {
  const { blockTimestamp, config, contractId, log, marketId, side } = input;

  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    fromAddress: requireValue(log.args.from, "from").toLowerCase(),
    logIndex: requireValue(log.logIndex, "logIndex"),
    marketId,
    outcomeToken: requireValue(log.address, "address").toLowerCase(),
    side,
    toAddress: requireValue(log.args.to, "to").toLowerCase(),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
    value: requireValue(log.args.value, "value"),
  };
}

/**
 * Inserts the Transfer event and applies its balance deltas — debit `from`,
 * credit `to` — in one transaction. Replayed logs dedup on the event insert
 * and skip the deltas, so double delivery cannot double-count; zero-address
 * mint/burn legs skip the holder upsert entirely.
 */
export async function persistOutcomeTokenTransferRecord(
  record: OutcomeTokenTransferRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.outcomeTokenTransferEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.outcomeTokenTransferEvents.id });

    if (!inserted[0]) {
      return;
    }

    await applyBalanceDelta(tx, record, record.fromAddress, -record.value);
    await applyBalanceDelta(tx, record, record.toAddress, record.value);
  });
}

type TransactionHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyBalanceDelta(
  tx: TransactionHandle,
  record: OutcomeTokenTransferRecord,
  owner: string,
  delta: bigint,
) {
  if (owner === ZERO_ADDRESS) {
    return;
  }

  await tx
    .insert(schema.outcomeTokenBalances)
    .values({
      balance: delta,
      chainId: record.chainId,
      marketId: record.marketId,
      outcomeToken: record.outcomeToken,
      owner,
      side: record.side,
      updatedBlockNumber: record.blockNumber,
    })
    .onConflictDoUpdate({
      target: [
        schema.outcomeTokenBalances.chainId,
        schema.outcomeTokenBalances.outcomeToken,
        schema.outcomeTokenBalances.owner,
      ],
      set: {
        // Deltas are passed as strings so uint256-scale values never squeeze
        // through a driver number or int8 parameter.
        balance: sql`${schema.outcomeTokenBalances.balance} + ${delta.toString()}`,
        updatedBlockNumber: sql`GREATEST(${schema.outcomeTokenBalances.updatedBlockNumber}, ${record.blockNumber.toString()})`,
        updatedAt: new Date(),
      },
    });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Outcome token transfer log is missing ${name}.`);
  }

  return value;
}
