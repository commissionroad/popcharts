import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { schema } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
import { logValueRequirer } from "src/indexer/utils/log-values";
import { unixSecondsToDate } from "src/indexer/utils/unix-seconds";

const requireValue = logValueRequirer("MarketCreated log");

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
    metadata?: string;
    metadataHash?: `0x${string}`;
    openingProbabilityWad?: bigint;
    resolutionTime?: bigint;
    yesNotBefore?: bigint;
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
  status,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: MarketCreatedLog;
  /**
   * The market's status read from the contract, not assumed from the event.
   * `MarketCreated` carries no status, and which status a market is born in is
   * a property of the deployed contract — `UnderReview` today, `Active` once
   * ADR 0022's P4 gate lands — so hard-coding it here would silently
   * mis-project every new market the moment the contract changed.
   */
  status: MarketStatus;
}): MarketCreatedRecords {
  const blockNumber = requireValue(log.blockNumber, "blockNumber");
  const transactionHash = requireValue(log.transactionHash, "transactionHash");
  const logIndex = requireValue(log.logIndex, "logIndex");
  const marketId = requireValue(log.args.marketId, "marketId");
  const creator = requireValue(log.args.creator, "creator").toLowerCase();
  const metadataHash = requireValue(log.args.metadataHash, "metadataHash");
  const metadata = requireValue(log.args.metadata, "metadata");
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
  const yesNotBeforeUnix = requireValue(log.args.yesNotBefore, "yesNotBefore");
  const bypassAiResolution = requireValue(
    log.args.bypassAiResolution,
    "bypassAiResolution",
  );
  const graduationTime = unixSecondsToDate(graduationTimeUnix);
  const resolutionTime = unixSecondsToDate(resolutionTimeUnix);
  const yesNotBefore = unixSecondsToDate(yesNotBeforeUnix);

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
      metadata,
      metadataHash,
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
      openingProbabilityWad,
      resolutionTime,
      yesNotBefore,
      status,
    },
  };
}
