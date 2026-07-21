// DEBT GUARD (2026-07-14 repo health audit): at ~1,100+ lines this is the
// largest file in the server, mixing graduation orchestration, venue wiring,
// liquidity seeding, and settlement mirroring. It is tolerated as-is because
// it is a dev-only harness excluded from production builds. Split it the
// moment any part of it is imported by a non-dev code path.
import {
  getAbiItem,
  maxUint256,
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
import {
  createReadOnlyClient,
  createWalletClient,
  type BlockchainClient,
  type BlockchainWalletClient,
} from "src/blockchain/client";
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
  computeBandPassClearing,
  hashReceiptClaim,
  mockCollateralAbi,
  pregradManagerAbi,
  SIDE_NO,
  SIDE_YES,
  type BandPassClearingResult,
  type ClearingPlan,
  type ClearingReceipt,
  type ReceiptClaim,
} from "@popcharts/protocol";
import { fastForwardLocalRpc, readDevPrivateKey } from "./local-dev-chain";
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
import { selectPostgradInfo, serializeMarketRow } from "./markets";

const PREGRAD_MARKET_STATUS_ACTIVE = 0;
const PREGRAD_MARKET_STATUS_GRADUATING = 2;
const PREGRAD_MARKET_STATUS_GRADUATED = 3;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const MAX_TOPUP_ROUNDS = 6;

const RECEIPT_PLACED_EVENT = getAbiItem({
  abi: pregradManagerAbi,
  name: "ReceiptPlaced",
});

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketGraduateRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

export type ChainGraduationResult =
  | {
      kind: "already_graduated";
    }
  | {
      kind: "below_threshold";
      matchedMarketCap: bigint;
      threshold: bigint;
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
  graduateMarketOnChain: (
    marketId: bigint,
    force: boolean,
  ) => Promise<ChainGraduationResult>;
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
    force = false,
    marketId,
  }: {
    chainId: number;
    /**
     * When true, the flow mints dev collateral and places receipts until the
     * market covers its graduation threshold before settling. When false, a
     * market below its threshold is reported ineligible instead.
     */
    force?: boolean;
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

  const chainResult = await dependencies.graduateMarketOnChain(
    parsedMarketId,
    force,
  );

  if (chainResult.kind === "below_threshold") {
    return {
      kind: "ineligible",
      market: serializeGraduateMarketRow(row),
      message:
        `Matched liquidity ${chainResult.matchedMarketCap} is below the graduation ` +
        `threshold ${chainResult.threshold}. Use force to mint dev liquidity and graduate anyway.`,
      reason: "below_threshold",
    };
  }

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
      ...(chainResult.kind === "graduated"
        ? chainResult.transactionHashes
        : []),
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

  const publicClient = createReadOnlyClient();
  const walletClient = createWalletClient(
    privateKeyToAccount(readDevPrivateKey()),
  );
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
  publicClient: BlockchainClient;
  retainedCostTotal: bigint;
  walletClient: BlockchainWalletClient;
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
      account: walletClient.account.address,
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
 * Runs the server's manager-keyed on-chain graduation for one market:
 * band-pass eligibility gate → startGraduation → clearing-root submission →
 * finalize → per-receipt claims. Chain-agnostic despite the name — the
 * challenge-window fast-forward is a no-op once the deadline has passed (the
 * window defaults to 0, protocol ADR 0010). Consumed by both the dev endpoint
 * and the public graduation failsafe. `force` (dev-only) first mints and places
 * receipts to reach threshold; without it, a below-threshold market is reported
 * and never touched on-chain.
 */
export async function graduateLocalMarketOnChain(
  marketId: bigint,
  force: boolean,
): Promise<ChainGraduationResult> {
  const publicClient = createReadOnlyClient();
  const account = privateKeyToAccount(readDevPrivateKey());
  const walletClient = createWalletClient(account);
  const manager = config.contracts.pregradManager;
  const transactionHashes: Hash[] = [];
  const mirroredLogs: Log[] = [];

  const readState = () =>
    publicClient.readContract({
      abi: pregradManagerAbi,
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
      abi: pregradManagerAbi,
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
    abi: pregradManagerAbi,
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

    if (force) {
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
    } else {
      // Without force this flow settles only markets that already earned
      // graduation. Eligibility is the real band-pass matched cap over the
      // current book — the sum of min(YES,NO) coverage across price bands — not
      // min(totalYes,totalNo), which overstates it whenever demand does not
      // overlap in price and would graduate a lopsided book that clears to zero.
      const preview = clearReceipts(
        await collectMarketReceipts(publicClient, marketId),
        marketConfig.graduationThreshold,
        marketConfig.liquidityParameter,
      );

      if (
        !preview ||
        preview.matchedMarketCap < marketConfig.graduationThreshold
      ) {
        return {
          kind: "below_threshold",
          matchedMarketCap: preview?.matchedMarketCap ?? 0n,
          threshold: marketConfig.graduationThreshold,
        };
      }
    }
    await write("startGraduation", [marketId]);
  }

  const receipts = await collectMarketReceipts(publicClient, marketId);
  let clearingRoot = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: manager,
    functionName: "getClearingRoot",
    args: [marketId],
  });
  let plan: ClearingPlan | null = null;

  if (clearingRoot.merkleRoot === ZERO_HASH) {
    plan = clearReceipts(
      receipts,
      marketConfig.graduationThreshold,
      marketConfig.liquidityParameter,
    );
    if (!plan) {
      throw new Error(
        `Market ${marketId} is graduating with no receipts to clear.`,
      );
    }
    state = await readState();
    verifyReconstructedBookMatchesSnapshot(receipts, plan, state);

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
      abi: pregradManagerAbi,
      address: manager,
      functionName: "getClearingRoot",
      args: [marketId],
    });
  } else {
    // Resuming a previous run: only claim receipts when the stored root was
    // produced by this same plan, otherwise our proofs would not verify.
    const rebuilt = clearReceipts(
      receipts,
      marketConfig.graduationThreshold,
      marketConfig.liquidityParameter,
    );
    plan =
      rebuilt && rebuilt.merkleRoot === clearingRoot.merkleRoot
        ? rebuilt
        : null;
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
  publicClient: BlockchainClient;
  readState: () => Promise<{
    noShares: bigint;
    totalEscrowed: bigint;
    yesShares: bigint;
  }>;
  walletClient: BlockchainWalletClient;
  write: (functionName: "placeReceipt", args: unknown[]) => Promise<unknown>;
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
      { shares: maxBigInt(yesDeficit, escrowDeficit), side: SIDE_YES },
      { shares: maxBigInt(noDeficit, escrowDeficit), side: SIDE_NO },
    ].filter((buy) => buy.shares > 0n);

    for (const buy of buys) {
      const quote = await publicClient.readContract({
        abi: pregradManagerAbi,
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
  publicClient: BlockchainClient;
  walletClient: BlockchainWalletClient;
}) {
  const mintHash = await walletClient.writeContract({
    abi: mockCollateralAbi,
    address: collateral,
    functionName: "mint",
    args: [account, amount],
    chain: config.chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const allowance = await publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateral,
    functionName: "allowance",
    args: [account, config.contracts.pregradManager],
  });

  if (allowance < amount) {
    const approveHash = await walletClient.writeContract({
      abi: mockCollateralAbi,
      address: collateral,
      functionName: "approve",
      args: [config.contracts.pregradManager, maxUint256],
      chain: config.chain,
      account: walletClient.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}

/**
 * Runs the real band-pass sweep over a reconstructed receipt book. Returns null
 * for an empty book (nothing to clear).
 */
function clearReceipts(
  receipts: ClearingReceipt[],
  graduationThreshold: bigint,
  liquidityParameter: bigint,
): BandPassClearingResult | null {
  if (receipts.length === 0) {
    return null;
  }
  return computeBandPassClearing({
    graduationThreshold,
    liquidityParameter,
    receipts,
  });
}

/**
 * Confirms the receipt book reconstructed from logs matches the frozen on-chain
 * accounting the clearing root is validated against. The GraduationStarted
 * snapshot commits to receiptCount, totalEscrowed, yesShares, and noShares; we
 * re-derive each from the reconstructed receipts and refuse to submit on any
 * mismatch (a stale read, or a book that changed after the freeze).
 */
function verifyReconstructedBookMatchesSnapshot(
  receipts: ClearingReceipt[],
  plan: ClearingPlan,
  state: {
    noShares: bigint;
    receiptCount: bigint;
    totalEscrowed: bigint;
    yesShares: bigint;
  },
): void {
  const yesShares = receipts
    .filter((r) => r.side === SIDE_YES)
    .reduce((sum, r) => sum + r.shares, 0n);
  const noShares = receipts
    .filter((r) => r.side === SIDE_NO)
    .reduce((sum, r) => sum + r.shares, 0n);

  const mismatches: string[] = [];
  if (plan.totalEscrowed !== state.totalEscrowed) {
    mismatches.push(`escrow ${plan.totalEscrowed} != ${state.totalEscrowed}`);
  }
  if (BigInt(receipts.length) !== state.receiptCount) {
    mismatches.push(`receiptCount ${receipts.length} != ${state.receiptCount}`);
  }
  if (yesShares !== state.yesShares) {
    mismatches.push(`yesShares ${yesShares} != ${state.yesShares}`);
  }
  if (noShares !== state.noShares) {
    mismatches.push(`noShares ${noShares} != ${state.noShares}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Reconstructed book does not match the frozen on-chain snapshot ` +
        `(${mismatches.join("; ")}); refusing to submit a clearing root.`,
    );
  }
}

/** Reads every ReceiptPlaced log for a market from the local chain. */
async function collectMarketReceipts(
  publicClient: BlockchainClient,
  marketId: bigint,
): Promise<ClearingReceipt[]> {
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
    rHigh: log.args.rHigh!,
    rLow: log.args.rLow!,
    sequence: log.args.sequence!,
    shares: log.args.shares!,
    side: log.args.side!,
  }));
}

/**
 * Confirms the offchain claim leaf encoding still matches the contract before
 * committing a root the receipts could never claim against.
 */
async function assertLeafHashMatchesContract(
  publicClient: BlockchainClient,
  claim: ReceiptClaim,
) {
  const contractLeaf = await publicClient.readContract({
    abi: pregradManagerAbi,
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
  publicClient: BlockchainClient,
  logs: Log[],
) {
  const parsed = parseEventLogs({
    abi: pregradManagerAbi,
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
