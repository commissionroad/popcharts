import {
  completeSetBinaryMarketAbi,
  contractSideToMarketSide,
  MARKET_SIDES,
  marketSideToContractSide,
  POSTGRAD_MARKET_STATUS,
  type MarketSide,
} from "@popcharts/protocol";
import { type Hash, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  DevMarketResolveIneligibleReason,
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
import { hasGraduated } from "src/db/schema/markets";

import { reachChainTimestamp, readDevPrivateKey } from "./local-dev-chain";
import { calculateMatchedMarketCap } from "./matched-market-cap";
import {
  selectMarketResolution,
  selectPostgradInfo,
  serializeMarketRow,
} from "./markets";

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
      winningSide: MarketSide;
    }
  | {
      blockTimestamp: Date;
      kind: "resolved";
      transactionHash: Hash;
      winningSide: MarketSide;
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
      winningSide: MarketSide;
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
    side: MarketSide,
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

  // Force-resolve is available for the whole postgrad range, including a
  // market sitting in its dispute window: the dev flows that drive a market to
  // resolution now pass through `resolution_pending` on every network, since
  // the runner proposes even where the configured window is zero.
  if (!hasGraduated(row.market.status)) {
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

/**
 * Drives one local postgrad market from Trading to Resolved with the dev key,
 * whatever dispute window the adapter stamped on it.
 *
 * With a zero window (the local default) the contract keeps its single-step
 * `resolve()` path. With a window configured, `resolve()` from Trading reverts
 * `MarketNotDirectlyResolvable` and the market must walk the optimistic path
 * instead, so the dev flow walks all of it in one call: propose, get past the
 * dispute deadline, finalize. Either way the endpoint's contract with its
 * callers — the dev tools and the app's lifecycle specs — is unchanged in
 * shape; what changes on a chain that cannot warp is how long it takes, since
 * both gates are then waited out in real time (ADR 0028 G4).
 */
async function resolveLocalPostgradMarketOnChain(
  postgradMarket: `0x${string}`,
  side: MarketSide,
): Promise<ChainResolveResult> {
  const publicClient = createReadOnlyClient();
  const status = (await publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: postgradMarket,
    functionName: "status",
  })) as number;

  if (status === POSTGRAD_MARKET_STATUS.resolved) {
    const winningSide = (await publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarket,
      functionName: "winningSide",
    })) as number;

    return {
      blockTimestamp: await latestBlockTimestamp(publicClient),
      kind: "already_resolved",
      winningSide: contractSideToMarketSide(winningSide),
    };
  }

  if (status !== POSTGRAD_MARKET_STATUS.trading) {
    return {
      kind: "wrong_status",
      status,
    };
  }

  const [notBefore, disputeWindow] = await Promise.all([
    // The contract's per-outcome floor guard (TooEarlyToResolve) is real even
    // on a dev chain, so a dev resolution has to reach the resolved side's
    // gate before it can call resolve: it warps there where the chain allows
    // it, and otherwise waits it out in real time (ADR 0028 G4). A market
    // whose gate is further out than the wait limit is refused with a message
    // naming the window to shorten, instead of holding the request open.
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarket,
      functionName: side === "yes" ? "yesNotBefore" : "noNotBefore",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarket,
      functionName: "disputeWindow",
    }),
  ]);
  await reachChainTimestamp(publicClient, notBefore, {
    label: `${postgradMarket}'s ${side} resolution gate`,
  });

  const walletClient = createWalletClient(
    privateKeyToAccount(readDevPrivateKey()),
  );
  const contractSide = marketSideToContractSide(side);
  let receipt: TransactionReceipt;

  if (disputeWindow === 0n) {
    receipt = await confirmPostgradTransaction(
      publicClient,
      "resolve",
      await walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "resolve",
        args: [contractSide],
      }),
    );
  } else {
    await confirmPostgradTransaction(
      publicClient,
      "proposeResolution",
      await walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "proposeResolution",
        args: [contractSide],
      }),
    );
    // Read the deadline back rather than computing it: it is anchored to the
    // block the proposal actually landed in.
    await reachChainTimestamp(
      publicClient,
      await publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "disputeDeadline",
      }),
      { label: `${postgradMarket}'s dispute window` },
    );
    receipt = await confirmPostgradTransaction(
      publicClient,
      "finalizeResolution",
      await walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "finalizeResolution",
      }),
    );
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });

  return {
    blockTimestamp: new Date(Number(block.timestamp) * 1000),
    kind: "resolved",
    transactionHash: receipt.transactionHash,
    winningSide: side,
  };
}

/** Waits for a postgrad write and fails loudly on a reverted receipt. */
async function confirmPostgradTransaction(
  publicClient: ReturnType<typeof createReadOnlyClient>,
  label: string,
  transactionHash: Hash,
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`${label} transaction failed: ${transactionHash}`);
  }

  return receipt;
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
    resolution,
  );
}

/** Narrows untrusted request input to a known side, or null if unrecognized. */
function parseResolveSide(side: string): MarketSide | null {
  const normalized = side.toLowerCase();

  return MARKET_SIDES.find((value) => value === normalized) ?? null;
}

function formatSide(side: MarketSide) {
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
