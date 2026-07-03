import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  DevMarketCloseIneligibleReason,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { calculateMatchedMarketCap } from "./matched-market-cap";
import { serializeMarketRow } from "./markets";

const DEFAULT_HARDHAT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PREGRAD_MARKET_STATUS_ACTIVE = 0;
const PREGRAD_MARKET_STATUS_REFUNDED = 4;
const PREGRAD_DEV_CLOSE_ABI = parseAbi([
  "function getMarketConfig(uint256 marketId) view returns ((address collateral, address creator, bytes32 metadataHash, uint256 openingProbabilityWad, uint256 liquidityParameter, uint256 graduationThreshold, uint64 graduationDeadline, uint64 resolutionTime, bool bypassAiResolution))",
  "function getMarketState(uint256 marketId) view returns ((uint8 status, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt))",
  "function markRefundable(uint256 marketId)",
]);

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketCloseRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type ChainCloseResult =
  | {
      blockTimestamp: Date;
      kind: "already_refunded";
    }
  | {
      blockTimestamp: Date;
      kind: "closed";
      transactionHash: Hash;
    }
  | {
      kind: "wrong_status";
      status: number;
    };

/**
 * Discriminated outcome of a dev market close. Each variant maps to a distinct
 * HTTP response at the route layer; "closed" is idempotent and is also returned
 * when the market was already refunded.
 */
export type DevMarketCloseResult =
  | {
      kind: "closed";
      market: MarketResponse;
      refundAvailable: string;
      transactionHash?: Hash;
    }
  | {
      kind: "dev_disabled";
      message: string;
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: DevMarketCloseIneligibleReason;
    }
  | {
      kind: "invalid_market_id";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    };

/**
 * Injectable seams for closePregradMarketForRefund, so tests can cover the
 * eligibility and chain-status branches without a database or local RPC node.
 */
export type DevMarketCloseDependencies = {
  closeMarketOnChain: (marketId: bigint) => Promise<ChainCloseResult>;
  devCloseEnabled: () => boolean;
  markMarketRefunded: ({
    chainId,
    marketId,
    updatedAt,
  }: {
    chainId: number;
    marketId: bigint;
    updatedAt: Date;
  }) => Promise<MarketRow | null>;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<DevMarketCloseRow | null>;
};

/**
 * Dev-only escape hatch that force-closes a bootstrap market for refunds by
 * fast-forwarding the local chain past the graduation deadline and calling
 * markRefundable on-chain, then mirroring the refunded status into the
 * database. Refuses to run unless dev tools are enabled on the local network,
 * so it can never touch a live deployment.
 */
export async function closePregradMarketForRefund(
  {
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: string;
  },
  dependencies: DevMarketCloseDependencies = defaultDevMarketCloseDependencies,
): Promise<DevMarketCloseResult> {
  if (!dependencies.devCloseEnabled()) {
    return {
      kind: "dev_disabled",
      message: "Dev market close is disabled.",
    };
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      kind: "invalid_market_id",
      message: "Invalid chain id.",
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

  const market = serializeCloseMarketRow(row);

  if (row.market.status === "refunded") {
    return {
      kind: "closed",
      market,
      refundAvailable: row.market.totalEscrowed.toString(),
    };
  }

  if (row.market.status !== "bootstrap") {
    return {
      kind: "ineligible",
      market,
      message: `Market is ${row.market.status}; only bootstrap markets can be closed for dev refunds.`,
      reason: "wrong_status",
    };
  }

  const chainResult = await dependencies.closeMarketOnChain(parsedMarketId);

  if (chainResult.kind === "wrong_status") {
    return {
      kind: "ineligible",
      market,
      message: `Market is not active on-chain; contract status is ${chainResult.status}.`,
      reason: "chain_status",
    };
  }

  const updatedMarket = await dependencies.markMarketRefunded({
    chainId,
    marketId: parsedMarketId,
    updatedAt: chainResult.blockTimestamp,
  });
  const serializedMarket = serializeCloseMarketRow({
    market: updatedMarket ?? {
      ...row.market,
      status: "refunded",
      updatedAt: chainResult.blockTimestamp,
    },
    metadata: row.metadata,
  });

  return {
    kind: "closed",
    market: serializedMarket,
    refundAvailable: serializedMarket.totalEscrowed,
    ...(chainResult.kind === "closed"
      ? { transactionHash: chainResult.transactionHash }
      : {}),
  };
}

function serializeCloseMarketRow(row: DevMarketCloseRow) {
  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
  );
}

const defaultDevMarketCloseDependencies: DevMarketCloseDependencies = {
  closeMarketOnChain: closeLocalMarketOnChain,
  devCloseEnabled: () => config.devToolsEnabled && config.name === "local",
  markMarketRefunded,
  selectMarket: selectMarketForDevClose,
};

async function selectMarketForDevClose({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<DevMarketCloseRow | null> {
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

async function markMarketRefunded({
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
      status: "refunded",
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

async function closeLocalMarketOnChain(
  marketId: bigint,
): Promise<ChainCloseResult> {
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const state = (await publicClient.readContract({
    abi: PREGRAD_DEV_CLOSE_ABI,
    address: config.contracts.pregradManager,
    functionName: "getMarketState",
    args: [marketId],
  })) as { status: number };

  if (state.status === PREGRAD_MARKET_STATUS_REFUNDED) {
    return {
      blockTimestamp: await getLatestBlockTimestamp(publicClient),
      kind: "already_refunded",
    };
  }

  if (state.status !== PREGRAD_MARKET_STATUS_ACTIVE) {
    return {
      kind: "wrong_status",
      status: state.status,
    };
  }

  const marketConfig = (await publicClient.readContract({
    abi: PREGRAD_DEV_CLOSE_ABI,
    address: config.contracts.pregradManager,
    functionName: "getMarketConfig",
    args: [marketId],
  })) as { graduationDeadline: bigint };

  await fastForwardLocalRpc(publicClient, marketConfig.graduationDeadline);

  const account = privateKeyToAccount(readDevPrivateKey());
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const transactionHash = await walletClient.writeContract({
    abi: PREGRAD_DEV_CLOSE_ABI,
    address: config.contracts.pregradManager,
    functionName: "markRefundable",
    args: [marketId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`markRefundable transaction failed: ${transactionHash}`);
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });

  return {
    blockTimestamp: new Date(Number(block.timestamp) * 1000),
    kind: "closed",
    transactionHash,
  };
}

async function fastForwardLocalRpc(
  publicClient: ReturnType<typeof createPublicClient>,
  targetTimestamp: bigint,
) {
  const latestBlock = await publicClient.getBlock();

  if (latestBlock.timestamp >= targetTimestamp) {
    return;
  }

  await requestLocalRpc("evm_setNextBlockTimestamp", [Number(targetTimestamp)]);
}

async function requestLocalRpc(method: string, params: unknown[]) {
  const response = await fetch(config.rpcHttpUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: {
      message?: string;
    };
  };

  if (!response.ok || body.error) {
    throw new Error(
      body.error?.message ?? `${method} failed with HTTP ${response.status}`,
    );
  }
}

async function getLatestBlockTimestamp(
  publicClient: ReturnType<typeof createPublicClient>,
) {
  const block = await publicClient.getBlock();

  return new Date(Number(block.timestamp) * 1000);
}

function readDevPrivateKey(): `0x${string}` {
  const value =
    process.env.POPCHARTS_DEVCHAIN_PRIVATE_KEY ??
    process.env.POPCHARTS_DEPLOYER_PRIVATE_KEY ??
    DEFAULT_HARDHAT_PRIVATE_KEY;

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      "POPCHARTS_DEVCHAIN_PRIVATE_KEY must be a 32-byte hex key.",
    );
  }

  return value as `0x${string}`;
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
