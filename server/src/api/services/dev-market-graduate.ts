import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  type Hash,
  type Log,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  DevMarketGraduateIneligibleReason,
  GraduationSummaryResponse,
  MarketPostgradResponse,
  MarketResponse,
  MarketVenueResponse,
} from "src/api/models/markets";
import { config, ZERO_ADDRESS } from "src/config";
import { and, db, eq, schema } from "src/db/client";
import {
  buildClearingRootSubmittedRecord,
  buildGraduatedReceiptClaimedRecord,
  buildGraduationFinalizedRecord,
  buildGraduationStartedRecord,
  persistClearingRootSubmittedRecord,
  persistGraduatedReceiptClaimedRecord,
  persistGraduationFinalizedRecord,
  persistGraduationStartedRecord,
  type ClearingRootSubmittedLog,
  type GraduatedReceiptClaimedLog,
  type GraduationFinalizedLog,
  type GraduationStartedLog,
} from "src/indexer/handlers/settlement";
import {
  buildReceiptPlacedRecord,
  persistReceiptPlacedRecord,
  type ReceiptPlacedLog,
} from "src/indexer/handlers/receipt-placed";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";

import {
  buildDevClearingPlan,
  hashReceiptClaim,
  type DevClearingPlan,
  type DevClearingReceipt,
  type DevReceiptClaim,
} from "./dev-graduation-clearing";
import {
  fastForwardLocalRpc,
  readDevPrivateKey,
} from "./local-dev-chain";
import { ensureDevBackstopLiquidity } from "@popcharts/protocol";

import {
  buildGraduatedMarketManifest,
  closingYesDisplayPriceWad,
  createVenueContractWriter,
  postgradVenueConfigured,
  readPostgradMarketVenue,
  wirePostgradMarketVenue,
} from "./postgrad-venue";
import {
  buildGraduationSummary,
  serializeGraduationSummary,
} from "./graduation";
import { calculateMatchedMarketCap } from "./matched-market-cap";
import {
  selectPostgradInfo,
  serializeMarketRow,
} from "./markets";

const PREGRAD_MARKET_STATUS_ACTIVE = 0;
const PREGRAD_MARKET_STATUS_GRADUATING = 2;
const PREGRAD_MARKET_STATUS_GRADUATED = 3;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const MAX_TOPUP_ROUNDS = 6;

const PREGRAD_DEV_GRADUATE_ABI = parseAbi([
  "function getMarketConfig(uint256 marketId) view returns ((address collateral, address creator, bytes32 metadataHash, uint256 openingProbabilityWad, uint256 liquidityParameter, uint256 graduationThreshold, uint64 graduationDeadline, uint64 resolutionTime, bool bypassAiResolution))",
  "function getMarketState(uint256 marketId) view returns ((uint8 status, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt))",
  "function getClearingRoot(uint256 marketId) view returns ((bytes32 merkleRoot, address submitter, bytes32 snapshotHash, uint64 submittedAt, uint64 challengeDeadline, uint256 matchedMarketCap, uint256 retainedCostTotal, uint256 refundTotal, uint256 completeSetCount))",
  "function hashReceiptClaim((uint256 marketId, uint256 receiptId, address owner, uint8 side, uint256 retainedShares, uint256 retainedCost, uint256 refund) claim) pure returns (bytes32)",
  "function quoteReceipt(uint256 marketId, uint8 side, uint256 shares) view returns ((uint256 cost, int256 rLow, int256 rHigh))",
  "function placeReceipt((uint256 marketId, uint8 side, uint256 shares, uint256 maxCost) params) returns (uint256)",
  "function startGraduation(uint256 marketId) returns (bytes32)",
  "function submitClearingRoot((uint256 marketId, bytes32 merkleRoot, uint256 matchedMarketCap, uint256 retainedCostTotal, uint256 refundTotal, uint256 completeSetCount) params) returns (bytes32)",
  "function finalizeGraduation(uint256 marketId, address postgradAdapter)",
  "function claimGraduatedReceipt((uint256 marketId, uint256 receiptId, address owner, uint8 side, uint256 retainedShares, uint256 retainedCost, uint256 refund) claim, bytes32[] proof)",
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
  "event GraduationStarted(uint256 indexed marketId, address indexed manager, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt, bytes32 snapshotHash)",
  "event ClearingRootSubmitted(uint256 indexed marketId, address indexed submitter, bytes32 indexed merkleRoot, bytes32 snapshotHash, uint256 matchedMarketCap, uint256 retainedCostTotal, uint256 refundTotal, uint256 completeSetCount, uint64 submittedAt, uint64 challengeDeadline)",
  "event GraduationFinalized(uint256 indexed marketId, address indexed postgradAdapter, address indexed postgradMarket, uint256 completeSetCount, uint256 retainedCostTotal, uint256 refundTotal)",
  "event GraduatedReceiptClaimed(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 retainedShares, uint256 retainedCost, uint256 refund)",
]);

const RECEIPT_PLACED_EVENT = parseAbiItem(
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
);

const DEV_COLLATERAL_ABI = parseAbi([
  "function mint(address account, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketGraduateRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type ChainGraduationResult =
  | {
      kind: "already_graduated";
    }
  | {
      finalized: {
        blockTimestamp: Date;
        completeSetCount: bigint;
        matchedMarketCap: bigint;
        refundTotal: bigint;
        retainedCostTotal: bigint;
      };
      kind: "graduated";
      transactionHashes: Hash[];
    }
  | {
      deadline: Date;
      kind: "past_deadline";
    }
  | {
      kind: "wrong_status";
      status: number;
    };

/**
 * Discriminated outcome of a dev market graduation. Each variant maps to a
 * distinct HTTP response at the route layer; "graduated" is idempotent and is
 * also returned when the market already finalized on-chain.
 */
export type DevMarketGraduateResult =
  | {
      kind: "dev_disabled";
      message: string;
    }
  | {
      kind: "graduated";
      market: MarketResponse;
      postgrad: MarketPostgradResponse;
      summary: GraduationSummaryResponse;
      transactionHashes: Hash[];
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: DevMarketGraduateIneligibleReason;
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
 * Injectable seams for graduateDevMarket, so tests can cover the eligibility
 * branches without a database or local RPC node.
 */
export type DevMarketGraduateDependencies = {
  devGraduateEnabled: () => boolean;
  graduateMarketOnChain: (marketId: bigint) => Promise<ChainGraduationResult>;
  postgradAdapterConfigured: () => boolean;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<DevMarketGraduateRow | null>;
  selectPostgradInfo: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<MarketPostgradResponse | null>;
  wireVenue: (args: {
    market: MarketRow;
    postgradMarket: `0x${string}`;
    retainedCostTotal: bigint;
  }) => Promise<{
    transactionHashes: Hash[];
    venue: MarketVenueResponse | null;
  }>;
};

/**
 * Dev-only escape hatch that runs the whole graduation settlement a real
 * deployment performs across services: top up receipts until the market meets
 * its graduation threshold, start graduation, submit a clearing root, jump the
 * local chain past any configured challenge window, finalize into a postgrad
 * market via the configured adapter, and claim every receipt so outcome tokens
 * and refunds actually move. Refuses to run unless dev tools are enabled on
 * the local network, so it can never touch a live deployment.
 */
export async function graduateDevMarket(
  {
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: string;
  },
  dependencies: DevMarketGraduateDependencies = defaultDependencies,
): Promise<DevMarketGraduateResult> {
  if (!dependencies.devGraduateEnabled()) {
    return {
      kind: "dev_disabled",
      message: "Dev market graduation is disabled.",
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

  if (
    row.market.status !== "bootstrap" &&
    row.market.status !== "graduating" &&
    row.market.status !== "graduated"
  ) {
    return {
      kind: "ineligible",
      market: serializeGraduateMarketRow(row),
      message: `Market is ${row.market.status}; only bootstrap or graduating markets can run dev graduation.`,
      reason: "wrong_status",
    };
  }

  if (!dependencies.postgradAdapterConfigured()) {
    return {
      kind: "ineligible",
      market: serializeGraduateMarketRow(row),
      message:
        "No postgrad adapter is configured. Redeploy local contracts so LOCAL_POSTGRAD_ADAPTER_ADDRESS is set.",
      reason: "adapter_unconfigured",
    };
  }

  const chainResult = await dependencies.graduateMarketOnChain(parsedMarketId);

  if (chainResult.kind === "wrong_status") {
    return {
      kind: "ineligible",
      market: serializeGraduateMarketRow(row),
      message: `Market cannot graduate on-chain; contract status is ${chainResult.status}.`,
      reason: "chain_status",
    };
  }

  if (chainResult.kind === "past_deadline") {
    return {
      kind: "ineligible",
      market: serializeGraduateMarketRow(row),
      message: `Market passed its graduation deadline at ${chainResult.deadline.toISOString()}; close it for refunds instead.`,
      reason: "past_deadline",
    };
  }

  const updatedRow =
    (await dependencies.selectMarket({
      chainId,
      marketId: parsedMarketId,
    })) ?? row;
  const postgrad = await dependencies.selectPostgradInfo({
    chainId,
    marketId: parsedMarketId,
  });

  if (!postgrad) {
    throw new Error(
      `Market ${chainId}:${marketId} graduated on-chain but no GraduationFinalized record was found.`,
    );
  }

  // Wire (or heal) the venue side of the handoff so trading continues on the
  // postgrad pools: idempotent, so re-running on an already graduated market
  // only fills in whatever is missing.
  const wiredVenue = await dependencies.wireVenue({
    market: updatedRow.market,
    postgradMarket: postgrad.marketAddress as `0x${string}`,
    retainedCostTotal: BigInt(postgrad.retainedCostTotal),
  });

  return {
    kind: "graduated",
    market: serializeGraduateMarketRow(updatedRow),
    postgrad: wiredVenue.venue
      ? { ...postgrad, venue: wiredVenue.venue }
      : postgrad,
    summary: serializeGraduationSummary(
      buildGraduationSummary({
        graduatedAt: new Date(postgrad.finalizedAt),
        graduationThreshold: updatedRow.market.graduationThreshold,
        matchedMarketCap: BigInt(postgrad.retainedCostTotal),
        receiptCount: updatedRow.market.receiptCount,
        totalEscrowed:
          BigInt(postgrad.retainedCostTotal) + BigInt(postgrad.refundTotal),
      }),
    ),
    transactionHashes: [
      ...(chainResult.kind === "graduated" ? chainResult.transactionHashes : []),
      ...wiredVenue.transactionHashes,
    ],
  };
}

function serializeGraduateMarketRow(row: DevMarketGraduateRow) {
  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
  );
}

const defaultDependencies: DevMarketGraduateDependencies = {
  devGraduateEnabled: () => config.devToolsEnabled && config.name === "local",
  graduateMarketOnChain: graduateLocalMarketOnChain,
  postgradAdapterConfigured: () =>
    config.contracts.postgradAdapter !== ZERO_ADDRESS &&
    Boolean(config.contracts.postgradAdapter),
  selectMarket: selectMarketForDevGraduate,
  selectPostgradInfo,
  wireVenue: wireVenueWithDevSigner,
};

/**
 * Default venue wiring: opens the postgrad pools where the pregrad book
 * closed, using the dev signer that owns the venue contracts locally. Skips
 * quietly when no venue is configured so bare pregrad-only setups still
 * graduate.
 */
async function wireVenueWithDevSigner({
  market,
  postgradMarket,
  retainedCostTotal,
}: {
  market: MarketRow;
  postgradMarket: `0x${string}`;
  retainedCostTotal: bigint;
}): Promise<{ transactionHashes: Hash[]; venue: MarketVenueResponse | null }> {
  if (!postgradVenueConfigured()) {
    console.log(
      "[Dev graduate] No postgrad venue configured; skipping pool wiring.",
    );
    return { transactionHashes: [], venue: null };
  }

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const walletClient = createWalletClient({
    account: privateKeyToAccount(readDevPrivateKey()),
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const collateral = market.collateral as `0x${string}`;
  const wired = await wirePostgradMarketVenue({
    clients: { publicClient, walletClient },
    collateral,
    postgradMarket,
    yesDisplayPriceWad: closingYesDisplayPriceWad({
      liquidityParameter: market.liquidityParameter,
      noShares: market.noShares,
      openingProbabilityWad: market.openingProbabilityWad,
      yesShares: market.yesShares,
    }),
  });

  await seedVenueLiquidity({
    collateral,
    postgradMarket,
    publicClient,
    retainedCostTotal,
    walletClient,
  });

  const venue = await readPostgradMarketVenue({ collateral, postgradMarket });

  return { transactionHashes: wired.transactionHashes, venue };
}

/**
 * Seeds each freshly wired pool with a dev backstop position sized by
 * POPCHARTS_VENUE_SEED_BPS of the market's retained collateral per leg, so a
 * graduated market is swappable immediately. Skips pools that already hold
 * liquidity; a seeding failure logs but never fails the graduation that
 * already settled.
 */
async function seedVenueLiquidity({
  collateral,
  postgradMarket,
  publicClient,
  retainedCostTotal,
  walletClient,
}: {
  collateral: `0x${string}`;
  postgradMarket: `0x${string}`;
  publicClient: ReturnType<typeof createPublicClient>;
  retainedCostTotal: bigint;
  walletClient: ReturnType<typeof createWalletClient>;
}): Promise<void> {
  if (config.venueSeedBps <= 0) {
    return;
  }

  if (config.contracts.swapRouter === ZERO_ADDRESS) {
    console.log(
      "[Dev graduate] No swap router configured; skipping liquidity seeding.",
    );
    return;
  }

  const devCollateral =
    (retainedCostTotal * BigInt(config.venueSeedBps)) / 10_000n;

  if (devCollateral <= 0n) {
    return;
  }

  try {
    const manifest = await buildGraduatedMarketManifest({
      collateral,
      postgradMarket,
      publicClient,
    });

    await ensureDevBackstopLiquidity({
      account: walletClient.account!.address,
      chainId: config.chainId,
      devCollateral,
      manifest,
      publicClient: publicClient as PublicClient,
      sides: ["yes", "no"],
      swapRouter: config.contracts.swapRouter,
      walletClient: createVenueContractWriter(walletClient),
    });
  } catch (error) {
    console.warn(
      `[Dev graduate] Venue liquidity seeding failed for ${postgradMarket}:`,
      error,
    );
  }
}

async function selectMarketForDevGraduate({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<DevMarketGraduateRow | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .innerJoin(
      schema.contracts,
      and(
        eq(schema.contracts.id, schema.markets.contractId),
        eq(schema.contracts.chainId, schema.markets.chainId),
      ),
    )
    .leftJoin(
      schema.marketMetadata,
      and(
        eq(schema.marketMetadata.chainId, schema.markets.chainId),
        eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
      ),
    )
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

/**
 * Drives the full graduation settlement on the local chain with the dev
 * account (the PregradManager owner in local deployments). Mirrors every
 * emitted event through the indexer's idempotent persistence handlers so the
 * database projection is settled before the endpoint responds, regardless of
 * live-watcher latency.
 */
async function graduateLocalMarketOnChain(
  marketId: bigint,
): Promise<ChainGraduationResult> {
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const account = privateKeyToAccount(readDevPrivateKey());
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });
  const manager = config.contracts.pregradManager;
  const transactionHashes: Hash[] = [];
  const mirroredLogs: Log[] = [];

  const readState = () =>
    publicClient.readContract({
      abi: PREGRAD_DEV_GRADUATE_ABI,
      address: manager,
      functionName: "getMarketState",
      args: [marketId],
    });
  const write = async (
    functionName:
      | "claimGraduatedReceipt"
      | "finalizeGraduation"
      | "placeReceipt"
      | "startGraduation"
      | "submitClearingRoot",
    args: unknown[],
  ) => {
    const hash = await walletClient.writeContract({
      abi: PREGRAD_DEV_GRADUATE_ABI,
      address: manager,
      functionName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: args as any,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      throw new Error(`${functionName} transaction failed: ${hash}`);
    }

    transactionHashes.push(hash);
    mirroredLogs.push(...receipt.logs);

    return receipt;
  };

  let state = await readState();

  if (state.status === PREGRAD_MARKET_STATUS_GRADUATED) {
    return { kind: "already_graduated" };
  }

  if (
    state.status !== PREGRAD_MARKET_STATUS_ACTIVE &&
    state.status !== PREGRAD_MARKET_STATUS_GRADUATING
  ) {
    return { kind: "wrong_status", status: state.status };
  }

  const marketConfig = await publicClient.readContract({
    abi: PREGRAD_DEV_GRADUATE_ABI,
    address: manager,
    functionName: "getMarketConfig",
    args: [marketId],
  });

  if (state.status === PREGRAD_MARKET_STATUS_ACTIVE) {
    const latestBlock = await publicClient.getBlock();

    if (latestBlock.timestamp >= marketConfig.graduationDeadline) {
      return {
        deadline: new Date(Number(marketConfig.graduationDeadline) * 1000),
        kind: "past_deadline",
      };
    }

    await topUpToGraduationThreshold({
      account: account.address,
      collateral: marketConfig.collateral,
      graduationThreshold: marketConfig.graduationThreshold,
      marketId,
      publicClient,
      readState,
      walletClient,
      write,
    });
    await write("startGraduation", [marketId]);
  }

  const receipts = await collectMarketReceipts(publicClient, marketId);
  let clearingRoot = await publicClient.readContract({
    abi: PREGRAD_DEV_GRADUATE_ABI,
    address: manager,
    functionName: "getClearingRoot",
    args: [marketId],
  });
  let plan: DevClearingPlan | null = null;

  if (clearingRoot.merkleRoot === ZERO_HASH) {
    plan = buildDevClearingPlan({
      graduationThreshold: marketConfig.graduationThreshold,
      receipts,
    });
    state = await readState();

    if (plan.totalEscrowed !== state.totalEscrowed) {
      throw new Error(
        `Receipt log escrow ${plan.totalEscrowed} does not match the on-chain snapshot ${state.totalEscrowed}; refusing to submit a clearing root.`,
      );
    }

    await assertLeafHashMatchesContract(publicClient, plan.claims[0]!);
    await write("submitClearingRoot", [
      {
        completeSetCount: plan.completeSetCount,
        marketId,
        matchedMarketCap: plan.matchedMarketCap,
        merkleRoot: plan.merkleRoot,
        refundTotal: plan.refundTotal,
        retainedCostTotal: plan.retainedCostTotal,
      },
    ]);
    clearingRoot = await publicClient.readContract({
      abi: PREGRAD_DEV_GRADUATE_ABI,
      address: manager,
      functionName: "getClearingRoot",
      args: [marketId],
    });
  } else {
    // Resuming a previous run: only claim receipts when the stored root was
    // produced by this same plan, otherwise our proofs would not verify.
    const rebuilt = buildDevClearingPlan({
      graduationThreshold: marketConfig.graduationThreshold,
      receipts,
    });
    plan = rebuilt.merkleRoot === clearingRoot.merkleRoot ? rebuilt : null;
  }

  await fastForwardLocalRpc(publicClient, clearingRoot.challengeDeadline);
  const finalizeReceipt = await write("finalizeGraduation", [
    marketId,
    config.contracts.postgradAdapter,
  ]);

  if (plan) {
    for (const [index, claim] of plan.claims.entries()) {
      await write("claimGraduatedReceipt", [
        {
          marketId: claim.marketId,
          owner: claim.owner,
          receiptId: claim.receiptId,
          refund: claim.refund,
          retainedCost: claim.retainedCost,
          retainedShares: claim.retainedShares,
          side: claim.side,
        },
        plan.proofs[index]!,
      ]);
    }
  }

  await mirrorSettlementLogs(publicClient, mirroredLogs);

  const finalizeBlock = await publicClient.getBlock({
    blockNumber: finalizeReceipt.blockNumber,
  });

  return {
    finalized: {
      blockTimestamp: new Date(Number(finalizeBlock.timestamp) * 1000),
      completeSetCount: clearingRoot.completeSetCount,
      matchedMarketCap: clearingRoot.matchedMarketCap,
      refundTotal: clearingRoot.refundTotal,
      retainedCostTotal: clearingRoot.retainedCostTotal,
    },
    kind: "graduated",
    transactionHashes,
  };
}

/**
 * Places dev receipts until the market's matched cap and escrow both cover
 * the graduation threshold. Buying equal share quantities on both sides
 * raises escrow by the same amount, so a couple of rounds always converge;
 * the loop re-reads chain state each round to absorb fixed-point rounding.
 */
async function topUpToGraduationThreshold({
  account,
  collateral,
  graduationThreshold,
  marketId,
  publicClient,
  readState,
  walletClient,
  write,
}: {
  account: `0x${string}`;
  collateral: `0x${string}`;
  graduationThreshold: bigint;
  marketId: bigint;
  publicClient: ReturnType<typeof createPublicClient>;
  readState: () => Promise<{
    noShares: bigint;
    totalEscrowed: bigint;
    yesShares: bigint;
  }>;
  walletClient: ReturnType<typeof createWalletClient>;
  write: (
    functionName: "placeReceipt",
    args: unknown[],
  ) => Promise<unknown>;
}) {
  for (let round = 0; round < MAX_TOPUP_ROUNDS; round += 1) {
    const state = await readState();
    const yesDeficit = clampToZero(graduationThreshold - state.yesShares);
    const noDeficit = clampToZero(graduationThreshold - state.noShares);
    const escrowDeficit = clampToZero(
      graduationThreshold - state.totalEscrowed,
    );

    if (yesDeficit === 0n && noDeficit === 0n && escrowDeficit === 0n) {
      return;
    }

    // Fold the escrow deficit into both sides: buying X YES and X NO moves
    // total escrow up by exactly X in the LMSR cost function.
    const buys: Array<{ shares: bigint; side: number }> = [
      { shares: maxBigInt(yesDeficit, escrowDeficit), side: 0 },
      { shares: maxBigInt(noDeficit, escrowDeficit), side: 1 },
    ].filter((buy) => buy.shares > 0n);

    for (const buy of buys) {
      const quote = await publicClient.readContract({
        abi: PREGRAD_DEV_GRADUATE_ABI,
        address: config.contracts.pregradManager,
        functionName: "quoteReceipt",
        args: [marketId, buy.side, buy.shares],
      });
      const maxCost = quote.cost + quote.cost / 50n + 1n;

      await fundDevCollateral({
        account,
        amount: maxCost,
        collateral,
        publicClient,
        walletClient,
      });
      await write("placeReceipt", [
        {
          marketId,
          maxCost,
          shares: buy.shares,
          side: buy.side,
        },
      ]);
    }
  }

  throw new Error(
    "Could not raise the market above its graduation threshold with dev receipts.",
  );
}

/** Mints dev collateral and grants the manager allowance to escrow it. */
async function fundDevCollateral({
  account,
  amount,
  collateral,
  publicClient,
  walletClient,
}: {
  account: `0x${string}`;
  amount: bigint;
  collateral: `0x${string}`;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}) {
  const mintHash = await walletClient.writeContract({
    abi: DEV_COLLATERAL_ABI,
    address: collateral,
    functionName: "mint",
    args: [account, amount],
    chain: config.chain,
    account: walletClient.account!,
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const allowance = await publicClient.readContract({
    abi: DEV_COLLATERAL_ABI,
    address: collateral,
    functionName: "allowance",
    args: [account, config.contracts.pregradManager],
  });

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      abi: DEV_COLLATERAL_ABI,
      address: collateral,
      functionName: "approve",
      args: [config.contracts.pregradManager, maxUint256],
      chain: config.chain,
      account: walletClient.account!,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}

/** Reads every ReceiptPlaced log for a market from the local chain. */
async function collectMarketReceipts(
  publicClient: ReturnType<typeof createPublicClient>,
  marketId: bigint,
): Promise<DevClearingReceipt[]> {
  const logs = await publicClient.getLogs({
    address: config.contracts.pregradManager,
    event: RECEIPT_PLACED_EVENT,
    args: { marketId },
    fromBlock: config.deployBlock,
    toBlock: "latest",
  });

  return logs.map((log) => ({
    cost: log.args.cost!,
    marketId: log.args.marketId!,
    owner: log.args.owner!,
    receiptId: log.args.receiptId!,
    shares: log.args.shares!,
    side: log.args.side!,
  }));
}

/**
 * Confirms the offchain claim leaf encoding still matches the contract before
 * committing a root the receipts could never claim against.
 */
async function assertLeafHashMatchesContract(
  publicClient: ReturnType<typeof createPublicClient>,
  claim: DevReceiptClaim,
) {
  const contractLeaf = await publicClient.readContract({
    abi: PREGRAD_DEV_GRADUATE_ABI,
    address: config.contracts.pregradManager,
    functionName: "hashReceiptClaim",
    args: [
      {
        marketId: claim.marketId,
        owner: claim.owner,
        receiptId: claim.receiptId,
        refund: claim.refund,
        retainedCost: claim.retainedCost,
        retainedShares: claim.retainedShares,
        side: claim.side,
      },
    ],
  });

  if (contractLeaf !== hashReceiptClaim(claim)) {
    throw new Error(
      "Offchain receipt claim hashing diverged from the contract; refusing to submit a clearing root.",
    );
  }
}

/**
 * Replays the transactions' settlement logs through the same idempotent
 * handlers the indexer uses, so the projection is consistent whether this
 * mirror or the live watcher lands first.
 */
async function mirrorSettlementLogs(
  publicClient: ReturnType<typeof createPublicClient>,
  logs: Log[],
) {
  const parsed = parseEventLogs({
    abi: PREGRAD_DEV_GRADUATE_ABI,
    logs,
  });
  const managerAddress = config.contracts.pregradManager.toLowerCase();
  const managerLogs = parsed
    .filter((log) => log.address.toLowerCase() === managerAddress)
    .sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.logIndex - right.logIndex
        : Number(left.blockNumber - right.blockNumber),
    );

  if (managerLogs.length === 0) {
    return;
  }

  const contractId = await getOrCreateContractId(
    config.contracts.pregradManager,
    "PregradManager",
  );
  const blockTimestamps = new Map<bigint, Date>();
  const blockTimestamp = async (blockNumber: bigint) => {
    const cached = blockTimestamps.get(blockNumber);

    if (cached) {
      return cached;
    }

    const block = await publicClient.getBlock({ blockNumber });
    const timestamp = new Date(Number(block.timestamp) * 1000);
    blockTimestamps.set(blockNumber, timestamp);

    return timestamp;
  };

  for (const log of managerLogs) {
    const timestamp = await blockTimestamp(log.blockNumber);
    const shared = { blockTimestamp: timestamp, config, contractId };

    switch (log.eventName) {
      case "ReceiptPlaced":
        await persistReceiptPlacedRecord(
          buildReceiptPlacedRecord({
            ...shared,
            log: log as unknown as ReceiptPlacedLog,
          }),
        );
        break;
      case "GraduationStarted":
        await persistGraduationStartedRecord(
          buildGraduationStartedRecord({
            ...shared,
            log: log as unknown as GraduationStartedLog,
          }),
        );
        break;
      case "ClearingRootSubmitted":
        await persistClearingRootSubmittedRecord(
          buildClearingRootSubmittedRecord({
            ...shared,
            log: log as unknown as ClearingRootSubmittedLog,
          }),
        );
        break;
      case "GraduationFinalized":
        await persistGraduationFinalizedRecord(
          buildGraduationFinalizedRecord({
            ...shared,
            log: log as unknown as GraduationFinalizedLog,
          }),
        );
        break;
      case "GraduatedReceiptClaimed":
        await persistGraduatedReceiptClaimedRecord(
          buildGraduatedReceiptClaimedRecord({
            ...shared,
            log: log as unknown as GraduatedReceiptClaimedLog,
          }),
        );
        break;
      default:
        break;
    }
  }
}

function clampToZero(value: bigint) {
  return value > 0n ? value : 0n;
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
