import {
  contractSideToMarketSide,
  marketSideToContractSide,
} from "@popcharts/protocol";
import { parseAbi, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  DevMarketResolveIneligibleReason,
  DevMarketResolveSide,
  MarketPostgradResponse,
  MarketResolutionResponse,
  MarketResponse,
} from "src/api/models/markets";
import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { fastForwardLocalRpc, readDevPrivateKey } from "./local-dev-chain";
import { calculateMatchedMarketCap } from "./matched-market-cap";
import {
  selectMarketResolution,
  selectPostgradInfo,
  serializeMarketRow,
} from "./markets";

const POSTGRAD_MARKET_STATUS_TRADING = 0;
const POSTGRAD_MARKET_STATUS_RESOLVED = 1;

export const POSTGRAD_DEV_RESOLVE_ABI = parseAbi([
  "function status() view returns (uint8)",
  "function winningSide() view returns (uint8)",
  "function yesNotBefore() view returns (uint64)",
  "function noNotBefore() view returns (uint64)",
  "function resolve(uint8 side)",
]);

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketResolveRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type ChainResolveResult =
  | {
      blockTimestamp: Date;
      kind: "already_resolved";
      winningSide: DevMarketResolveSide;
    }
  | {
      blockTimestamp: Date;
      kind: "resolved";
      transactionHash: Hash;
      winningSide: DevMarketResolveSide;
    }
  | {
      kind: "wrong_status";
      status: number;
    };

export type DevMarketResolveResult =
  | {
      kind: "dev_disabled";
      message: string;
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: DevMarketResolveIneligibleReason;
    }
  | {
      kind: "invalid_market_id";
      message: string;
    }
  | {
      kind: "invalid_side";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    }
  | {
      kind: "resolved";
      market: MarketResponse;
      transactionHash?: Hash;
      winningSide: DevMarketResolveSide;
    };

export type DevMarketResolveDependencies = {
  devResolveEnabled: () => boolean;
  markMarketResolved: ({
    chainId,
    marketId,
    updatedAt,
  }: {
    chainId: number;
    marketId: bigint;
    updatedAt: Date;
  }) => Promise<MarketRow | null>;
  resolveMarketOnChain: (
    postgradMarket: `0x${string}`,
    side: DevMarketResolveSide,
  ) => Promise<ChainResolveResult>;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<DevMarketResolveRow | null>;
  selectPostgradInfo: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<MarketPostgradResponse | null>;
  selectResolution: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<MarketResolutionResponse | null>;
};

/**
 * Dev-only escape hatch that resolves a graduated local postgrad market to
 * YES or NO, then mirrors the resolved status into the indexed market row.
 * This is intentionally local-only, like the dev close and graduation flows.
 */
export async function resolveDevMarket(
  {
    chainId,
    marketId,
    side,
  }: {
    chainId: number;
    marketId: string;
    side: string;
  },
  dependencies: DevMarketResolveDependencies = defaultDependencies,
): Promise<DevMarketResolveResult> {
  if (!dependencies.devResolveEnabled()) {
    return {
      kind: "dev_disabled",
      message: "Dev market resolution is disabled.",
    };
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      kind: "invalid_market_id",
      message: "Invalid chain id.",
    };
  }

  const parsedSide = parseResolveSide(side);

  if (!parsedSide) {
    return {
      kind: "invalid_side",
      message: "Resolution side must be yes or no.",
    };
  }

  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return {
      kind: "invalid_market_id",
      message: "Invalid market id.",
    };
  }

  const row = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!row) {
    return {
      kind: "not_found",
      message: "Market not found.",
    };
  }

  // The indexed terminal event, when the resolution already happened and the
  // indexer caught up; every response shape carries it so a dev-resolve
  // payload matches what getMarketById would serve.
  const indexedResolution = await dependencies.selectResolution({
    chainId,
    marketId: parsedMarketId,
  });
  const market = serializeResolveMarketRow(row, indexedResolution);

  if (row.market.status !== "graduated" && row.market.status !== "resolved") {
    return {
      kind: "ineligible",
      market,
      message: `Market is ${row.market.status}; only graduated markets can be force-resolved.`,
      reason: "wrong_status",
    };
  }

  const postgrad = await dependencies.selectPostgradInfo({
    chainId,
    marketId: parsedMarketId,
  });

  if (!postgrad) {
    return {
      kind: "ineligible",
      market,
      message: "Market has no indexed postgrad market to resolve.",
      reason: "postgrad_missing",
    };
  }

  const chainResult = await dependencies.resolveMarketOnChain(
    postgrad.marketAddress as `0x${string}`,
    parsedSide,
  );

  if (chainResult.kind === "wrong_status") {
    return {
      kind: "ineligible",
      market,
      message: `Postgrad market cannot resolve; contract status is ${chainResult.status}.`,
      reason: "chain_status",
    };
  }

  if (
    chainResult.kind === "already_resolved" &&
    chainResult.winningSide !== parsedSide
  ) {
    return {
      kind: "ineligible",
      market,
      message: `Market is already resolved ${formatSide(chainResult.winningSide)}.`,
      reason: "already_resolved",
    };
  }

  const updatedMarket = await dependencies.markMarketResolved({
    chainId,
    marketId: parsedMarketId,
    updatedAt: chainResult.blockTimestamp,
  });

  // A fresh resolve outruns the indexer, so synthesize the resolution from
  // the transaction we just confirmed; an already-indexed row wins because it
  // is the canonical terminal event.
  const resolution =
    indexedResolution ??
    (chainResult.kind === "resolved"
      ? {
          kind: "resolved" as const,
          postgradMarket: postgrad.marketAddress,
          resolvedAt: chainResult.blockTimestamp.toISOString(),
          transactionHash: chainResult.transactionHash,
          winningSide: chainResult.winningSide,
        }
      : null);

  return {
    kind: "resolved",
    market: serializeResolveMarketRow(
      {
        market: updatedMarket ?? {
          ...row.market,
          status: "resolved",
          updatedAt: chainResult.blockTimestamp,
        },
        metadata: row.metadata,
      },
      resolution,
    ),
    ...(chainResult.kind === "resolved"
      ? { transactionHash: chainResult.transactionHash }
      : {}),
    winningSide: chainResult.winningSide,
  };
}

const defaultDependencies: DevMarketResolveDependencies = {
  devResolveEnabled: () => config.devToolsEnabled && config.name === "local",
  markMarketResolved,
  resolveMarketOnChain: resolveLocalPostgradMarketOnChain,
  selectMarket: selectMarketForDevResolve,
  selectPostgradInfo,
  selectResolution: selectMarketResolution,
};

async function selectMarketForDevResolve({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<DevMarketResolveRow | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .leftJoin(schema.marketMetadata, marketMetadataJoinCondition())
    .where(
      and(
        eq(
          schema.contracts.address,
          config.contracts.pregradManager.toLowerCase(),
        ),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function markMarketResolved({
  chainId,
  marketId,
  updatedAt,
}: {
  chainId: number;
  marketId: bigint;
  updatedAt: Date;
}) {
  const [updatedMarket] = await db
    .update(schema.markets)
    .set({
      status: "resolved",
      updatedAt,
    })
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .returning();

  return updatedMarket ?? null;
}

async function resolveLocalPostgradMarketOnChain(
  postgradMarket: `0x${string}`,
  side: DevMarketResolveSide,
): Promise<ChainResolveResult> {
  const publicClient = createReadOnlyClient();
  const status = (await publicClient.readContract({
    abi: POSTGRAD_DEV_RESOLVE_ABI,
    address: postgradMarket,
    functionName: "status",
  })) as number;

  if (status === POSTGRAD_MARKET_STATUS_RESOLVED) {
    const winningSide = (await publicClient.readContract({
      abi: POSTGRAD_DEV_RESOLVE_ABI,
      address: postgradMarket,
      functionName: "winningSide",
    })) as number;

    return {
      blockTimestamp: await latestBlockTimestamp(publicClient),
      kind: "already_resolved",
      winningSide: contractSideToMarketSide(winningSide),
    };
  }

  if (status !== POSTGRAD_MARKET_STATUS_TRADING) {
    return {
      kind: "wrong_status",
      status,
    };
  }

  // The contract's per-outcome floor guard (TooEarlyToResolve) is real even
  // on a dev chain; a dev resolution jumps local chain time to the resolved
  // side's gate instead of asking the caller to wait days of wall clock.
  const notBefore = (await publicClient.readContract({
    abi: POSTGRAD_DEV_RESOLVE_ABI,
    address: postgradMarket,
    functionName: side === "yes" ? "yesNotBefore" : "noNotBefore",
  })) as bigint;
  await fastForwardLocalRpc(publicClient, notBefore);

  const account = privateKeyToAccount(readDevPrivateKey());
  const walletClient = createWalletClient(account);
  const transactionHash = await walletClient.writeContract({
    abi: POSTGRAD_DEV_RESOLVE_ABI,
    address: postgradMarket,
    functionName: "resolve",
    args: [marketSideToContractSide(side)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`resolve transaction failed: ${transactionHash}`);
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });

  return {
    blockTimestamp: new Date(Number(block.timestamp) * 1000),
    kind: "resolved",
    transactionHash,
    winningSide: side,
  };
}

function serializeResolveMarketRow(
  row: DevMarketResolveRow,
  resolution: MarketResolutionResponse | null = null,
) {
  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
    null,
    null,
    null,
    resolution,
  );
}

function parseResolveSide(side: string): DevMarketResolveSide | null {
  const normalized = side.toLowerCase();

  return normalized === "yes" || normalized === "no" ? normalized : null;
}

function formatSide(side: DevMarketResolveSide) {
  return side.toUpperCase();
}

async function latestBlockTimestamp(
  publicClient: ReturnType<typeof createReadOnlyClient>,
) {
  const block = await publicClient.getBlock();

  return new Date(Number(block.timestamp) * 1000);
}

function marketMetadataJoinCondition() {
  return and(
    eq(schema.marketMetadata.chainId, schema.markets.chainId),
    eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
  );
}

function marketContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.markets.contractId),
    eq(schema.contracts.chainId, schema.markets.chainId),
  );
}
