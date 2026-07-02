import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { schema } from "src/db/client";

export type MarketCreatedLog = Log & {
  args: {
    bypassAiResolution?: boolean;
    collateral?: `0x${string}`;
    creator?: `0x${string}`;
    graduationThreshold?: bigint;
    graduationDeadline?: bigint;
    graduationTime?: bigint;
    liquidityParameter?: bigint;
    marketId?: bigint;
    metadataHash?: `0x${string}`;
    metadataURI?: string;
    openingProbabilityWad?: bigint;
    resolutionTime?: bigint;
  };
};

export type MarketCreatedRecords = {
  event: typeof schema.marketCreatedEvents.$inferInsert;
  market: typeof schema.markets.$inferInsert;
};

export function buildMarketCreatedRecords({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: MarketCreatedLog;
}): MarketCreatedRecords {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");
  const marketId = requireValue(log.args.marketId, "marketId");
  const creator = requireValue(log.args.creator, "creator").toLowerCase();
  const metadataHash = requireValue(log.args.metadataHash, "metadataHash");
  const metadataUri = requireValue(log.args.metadataURI, "metadataURI");
  const collateral = requireValue(
    log.args.collateral,
    "collateral",
  ).toLowerCase();
  const openingProbabilityWad = requireValue(
    log.args.openingProbabilityWad,
    "openingProbabilityWad",
  );
  const liquidityParameter = requireValue(
    log.args.liquidityParameter,
    "liquidityParameter",
  );
  const graduationThreshold = requireValue(
    log.args.graduationThreshold,
    "graduationThreshold",
  );
  const graduationTimeUnix = requireValue(
    log.args.graduationDeadline ?? log.args.graduationTime,
    "graduationDeadline",
  );
  const resolutionTimeUnix = requireValue(
    log.args.resolutionTime,
    "resolutionTime",
  );
  const bypassAiResolution = requireValue(
    log.args.bypassAiResolution,
    "bypassAiResolution",
  );
  const graduationTime = unixSecondsToDate(graduationTimeUnix);
  const resolutionTime = unixSecondsToDate(resolutionTimeUnix);

  return {
    event: {
      blockNumber,
      blockTimestamp,
      bypassAiResolution,
      chainId: config.chainId,
      collateral,
      contractId,
      creator,
      graduationThreshold,
      graduationTime,
      graduationTimeUnix,
      liquidityParameter,
      logIndex,
      marketId,
      metadataHash,
      metadataUri,
      openingProbabilityWad,
      resolutionTime,
      resolutionTimeUnix,
      transactionHash,
    },
    market: {
      chainId: config.chainId,
      collateral,
      contractId,
      createdBlockNumber: blockNumber,
      createdBlockTimestamp: blockTimestamp,
      createdLogIndex: logIndex,
      createdTransactionHash: transactionHash,
      bypassAiResolution,
      creator,
      graduationThreshold,
      graduationTime,
      liquidityParameter,
      marketId,
      metadataHash,
      metadataUri,
      openingProbabilityWad,
      resolutionTime,
      status: "under_review",
    },
  };
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`MarketCreated log is missing ${name}.`);
  }

  return value;
}

function unixSecondsToDate(value: bigint) {
  return new Date(Number(value) * 1000);
}
