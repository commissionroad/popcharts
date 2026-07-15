import {
  COMPLETE_SET_PRICE_POLICY,
  sqrtPriceX96ToDisplayPriceWad,
} from "@popcharts/protocol";

import type { MarketResolutionResponse } from "src/api/models/markets";
import type {
  PortfolioOpenOrderResponse,
  PortfolioPositionResponse,
  PortfolioReceiptResponse,
  PortfolioReceiptStatusResponse,
  PortfolioRedemptionResponse,
  PortfolioResponse,
} from "src/api/models/portfolio";
import { and, db, desc, eq, schema } from "src/db/client";

import { serializeResolutionRow } from "./markets";
import {
  serializeVenueOrder,
  venueOrderDirection,
  venueOrderOutcomeSize,
  type VenueOrderRow,
  type VenuePoolRow,
} from "./venue-orderbook";
import {
  readCollateralDecimals,
  readPoolSqrtPricesX96,
} from "./postgrad-venue";

/**
 * Owner-scoped portfolio read (docs/portfolio-data-design.md): the wallet's
 * pre-graduation receipts joined to their settlement results, its graduated
 * YES/NO positions from the Transfer-indexed balance projection plus tokens
 * committed to its own resting ask orders, its open venue orders across
 * markets, and its past resolution-redemption payouts from the indexed
 * Redeemed/CancelledRedeemed paper trail. The only chain reads are each
 * pool's current price and each market collateral's decimals (memoized) for
 * tier-2 current value.
 */

const WAD = 10n ** 18n;

type MarketContext = {
  readonly collateral: string;
  readonly question: string | null;
  readonly status: string;
  /**
   * Terminal resolution event for a resolved/cancelled market; only loaded
   * where a claim affordance needs it (balance rows), so optional.
   */
  readonly resolution?: MarketResolutionResponse | null;
};

/** One placed receipt with its (optional) claim rows and market context. */
export type PortfolioReceiptRow = {
  readonly graduatedClaim: {
    readonly blockTimestamp: Date;
    readonly refund: bigint;
    readonly retainedCost: bigint;
    readonly retainedShares: bigint;
  } | null;
  readonly market: MarketContext;
  readonly placed: {
    readonly blockNumber: bigint;
    readonly blockTimestamp: Date;
    readonly cost: bigint;
    readonly logIndex: number;
    readonly marketId: bigint;
    readonly rHigh: string;
    readonly rLow: string;
    readonly receiptId: bigint;
    readonly shares: bigint;
    readonly side: number;
  };
  readonly refundClaim: {
    readonly blockTimestamp: Date;
    readonly refund: bigint;
  } | null;
};

/** One indexed balance row with its venue pool and market context. */
export type PortfolioBalanceRow = {
  readonly balance: {
    readonly balance: bigint;
    readonly marketId: bigint;
    readonly outcomeToken: string;
    readonly side: "yes" | "no";
  };
  readonly market: MarketContext | null;
  readonly pool: VenuePoolRow | null;
};

/** One open venue order with its pool and market context. */
export type PortfolioOrderRow = {
  readonly market: MarketContext | null;
  readonly order: VenueOrderRow;
  readonly pool: VenuePoolRow;
};

/** One indexed redemption payout with its market context. */
export type PortfolioRedemptionRow = {
  readonly market: MarketContext | null;
  readonly redemption: {
    readonly blockTimestamp: Date;
    readonly collateralAmount: bigint;
    readonly kind: "redeemed" | "cancelled_redeemed";
    readonly logIndex: number;
    readonly marketId: bigint;
    readonly noAmount: bigint | null;
    readonly outcomeAmount: bigint | null;
    readonly side: "yes" | "no" | null;
    readonly transactionHash: string;
    readonly yesAmount: bigint | null;
  };
};

/** Outcome of a portfolio read. */
export type PortfolioResult =
  | { kind: "invalid_owner"; message: string }
  | { kind: "invalid_chain"; message: string }
  | { kind: "portfolio"; portfolio: PortfolioResponse };

/** Data and chain reads the portfolio read depends on, injectable in tests. */
export type PortfolioReadDependencies = {
  readCollateralDecimals: (collateral: `0x${string}`) => Promise<number>;
  readPoolSqrtPricesX96: (
    poolIds: readonly string[],
  ) => Promise<Map<string, bigint>>;
  selectOwnerBalances: (args: {
    chainId: number;
    owner: string;
  }) => Promise<PortfolioBalanceRow[]>;
  selectOwnerOpenOrders: (args: {
    chainId: number;
    owner: string;
  }) => Promise<PortfolioOrderRow[]>;
  selectOwnerReceipts: (args: {
    chainId: number;
    owner: string;
  }) => Promise<PortfolioReceiptRow[]>;
  selectOwnerRedemptions: (args: {
    chainId: number;
    owner: string;
  }) => Promise<PortfolioRedemptionRow[]>;
};

/**
 * Assembles one wallet's portfolio. Pool prices and collateral decimals are
 * read best-effort: a failed venue read omits poolPriceWad/currentValueWad
 * rather than failing the whole portfolio, mirroring the order book's
 * missing-price behavior.
 */
export async function getPortfolio(
  { chainId, owner }: { chainId: number; owner: string },
  dependencies: PortfolioReadDependencies = defaultDependencies,
): Promise<PortfolioResult> {
  const normalizedOwner = owner.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(normalizedOwner)) {
    return {
      kind: "invalid_owner",
      message: `Invalid owner address: ${owner}`,
    };
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { kind: "invalid_chain", message: "Invalid chain id" };
  }

  const [receiptRows, balanceRows, orderRows, redemptionRows] =
    await Promise.all([
      dependencies.selectOwnerReceipts({ chainId, owner: normalizedOwner }),
      dependencies.selectOwnerBalances({ chainId, owner: normalizedOwner }),
      dependencies.selectOwnerOpenOrders({ chainId, owner: normalizedOwner }),
      dependencies.selectOwnerRedemptions({ chainId, owner: normalizedOwner }),
    ]);

  const receipts = receiptRows.map(serializeReceipt);
  const decimalsByCollateral = await readDecimalsBestEffort(
    dependencies,
    collateralAddresses(balanceRows, orderRows, redemptionRows),
  );
  const positions = await buildPositions({
    balanceRows,
    decimalsByCollateral,
    dependencies,
    orderRows,
    receiptRows,
  });
  const openOrders = serializeOpenOrders(orderRows, decimalsByCollateral);
  const redemptions = redemptionRows.map((row) =>
    serializeRedemption(row, decimalsByCollateral),
  );

  const lockedCollateral = receiptRows
    .filter((row) => serializeReceipt(row).status === "awaiting_graduation")
    .reduce((total, row) => total + row.placed.cost, 0n);
  const totalPositionValueWad = positions.reduce(
    (total, position) =>
      total +
      (position.currentValueWad ? BigInt(position.currentValueWad) : 0n),
    0n,
  );

  return {
    kind: "portfolio",
    portfolio: {
      chainId,
      openOrders,
      owner: normalizedOwner,
      positions,
      receipts,
      redemptions,
      summary: {
        claimableReceiptCount: receipts.filter(
          (receipt) =>
            receipt.status === "claimable" ||
            receipt.status === "refund_claimable",
        ).length,
        lockedCollateral: lockedCollateral.toString(),
        openOrderCount: openOrders.length,
        openReceiptCount: receipts.filter(
          (receipt) => receipt.status === "awaiting_graduation",
        ).length,
        positionCount: positions.length,
        totalPositionValueWad: totalPositionValueWad.toString(),
      },
    },
  };
}

/**
 * Maps a receipt row to its lifecycle status. A claim row wins outright;
 * otherwise the market's status decides whether the receipt is still waiting
 * or already claimable (graduated) / refund-claimable (refunded, cancelled).
 */
export function portfolioReceiptStatus(
  row: PortfolioReceiptRow,
): PortfolioReceiptStatusResponse {
  if (row.graduatedClaim) {
    return "settled";
  }

  if (row.refundClaim) {
    return "refunded";
  }

  if (row.market.status === "graduated" || row.market.status === "resolved") {
    return "claimable";
  }

  if (row.market.status === "refunded" || row.market.status === "cancelled") {
    return "refund_claimable";
  }

  return "awaiting_graduation";
}

function serializeReceipt(row: PortfolioReceiptRow): PortfolioReceiptResponse {
  const settlement = row.graduatedClaim
    ? {
        claimedAt: row.graduatedClaim.blockTimestamp.toISOString(),
        refund: row.graduatedClaim.refund.toString(),
        retainedCost: row.graduatedClaim.retainedCost.toString(),
        retainedShares: row.graduatedClaim.retainedShares.toString(),
      }
    : row.refundClaim
      ? {
          claimedAt: row.refundClaim.blockTimestamp.toISOString(),
          refund: row.refundClaim.refund.toString(),
        }
      : undefined;

  return {
    cost: row.placed.cost.toString(),
    marketId: row.placed.marketId.toString(),
    ...(row.market.question ? { marketQuestion: row.market.question } : {}),
    marketStatus: row.market.status as PortfolioReceiptResponse["marketStatus"],
    placedAt: row.placed.blockTimestamp.toISOString(),
    priceBandHigh: row.placed.rHigh,
    priceBandLow: row.placed.rLow,
    receiptId: row.placed.receiptId.toString(),
    ...(settlement ? { settlement } : {}),
    shares: row.placed.shares.toString(),
    // ReceiptPlaced encodes side 0 as YES and 1 as NO.
    side: row.placed.side === 0 ? "yes" : "no",
    status: portfolioReceiptStatus(row),
  };
}

/**
 * Builds per-(market, side) positions: held balances from the Transfer
 * projection, plus outcome tokens committed in the wallet's own open ask
 * orders (their input token left the wallet into the pool manager). Pools
 * with committed tokens but no balance row still produce a position. Rows
 * where both parts are zero (fully exited) are dropped.
 */
async function buildPositions({
  balanceRows,
  decimalsByCollateral,
  dependencies,
  orderRows,
  receiptRows,
}: {
  balanceRows: PortfolioBalanceRow[];
  decimalsByCollateral: Map<string, number>;
  dependencies: PortfolioReadDependencies;
  orderRows: PortfolioOrderRow[];
  receiptRows: PortfolioReceiptRow[];
}): Promise<PortfolioPositionResponse[]> {
  type PositionDraft = {
    committed: bigint;
    held: bigint;
    market: MarketContext | null;
    marketId: bigint;
    outcomeToken: string;
    pool: VenuePoolRow | null;
    side: "yes" | "no";
  };

  const drafts = new Map<string, PositionDraft>();

  for (const row of balanceRows) {
    drafts.set(row.balance.outcomeToken, {
      committed: 0n,
      held: row.balance.balance,
      market: row.market,
      marketId: row.balance.marketId,
      outcomeToken: row.balance.outcomeToken,
      pool: row.pool,
      side: row.balance.side,
    });
  }

  for (const row of orderRows) {
    const direction = venueOrderDirection({
      outcomeIsCurrency0: row.pool.outcomeIsCurrency0,
      zeroForOne: row.order.zeroForOne,
    });

    // Only asks commit outcome tokens; bids commit collateral.
    if (direction !== "ask") {
      continue;
    }

    const committed = venueOrderOutcomeSize({
      liquidity: row.order.remainingLiquidity,
      outcomeIsCurrency0: row.pool.outcomeIsCurrency0,
      tickLower: row.order.tickLower,
      tickUpper: row.order.tickUpper,
    });
    const draft = drafts.get(row.pool.outcomeToken) ?? {
      committed: 0n,
      held: 0n,
      market: row.market,
      marketId: row.pool.marketId,
      outcomeToken: row.pool.outcomeToken,
      pool: row.pool,
      side: row.pool.side,
    };

    draft.committed += committed;
    draft.pool ??= row.pool;
    draft.market ??= row.market;
    drafts.set(row.pool.outcomeToken, draft);
  }

  const settlementBySide = aggregateSettlements(receiptRows);
  const active = [...drafts.values()].filter(
    (draft) => draft.held + draft.committed > 0n,
  );
  const priceBySide = await readPoolPricesBestEffort(
    dependencies,
    active.flatMap((draft) => (draft.pool ? [draft.pool.poolId] : [])),
  );

  return active
    .sort((a, b) =>
      a.marketId === b.marketId
        ? a.side === b.side
          ? 0
          : a.side === "yes"
            ? -1
            : 1
        : a.marketId < b.marketId
          ? -1
          : 1,
    )
    .map((draft) => {
      const owned = draft.held + draft.committed;
      const decimals = draft.market
        ? decimalsByCollateral.get(draft.market.collateral)
        : undefined;
      const sqrtPriceX96 = draft.pool
        ? priceBySide.get(draft.pool.poolId)
        : undefined;
      const poolPriceWad =
        draft.pool &&
        decimals !== undefined &&
        sqrtPriceX96 !== undefined &&
        sqrtPriceX96 > 0n
          ? sqrtPriceX96ToDisplayPriceWad({
              collateralDecimals: decimals,
              outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
              outcomeIsCurrency0: draft.pool.outcomeIsCurrency0,
              sqrtPriceX96,
            })
          : undefined;
      // After a terminal event the pool quote is history; the settlement
      // price is a fact (winner 1, loser 0, draw ½) and wins outright.
      const priceWad =
        settledOutcomePriceWad(draft.market?.resolution ?? null, draft.side) ??
        poolPriceWad;
      const settlement = settlementBySide.get(
        settlementKey(draft.marketId, draft.side),
      );
      const avgCostWad =
        settlement && settlement.retainedShares > 0n && decimals !== undefined
          ? (collateralUnitsToWad(settlement.retainedCost, decimals) * WAD) /
            settlement.retainedShares
          : undefined;

      return {
        ...(avgCostWad !== undefined
          ? { avgCostWad: avgCostWad.toString() }
          : {}),
        committedInOrders: draft.committed.toString(),
        ...(priceWad !== undefined
          ? { currentValueWad: ((owned * priceWad) / WAD).toString() }
          : {}),
        ...(settlement
          ? { graduationShares: settlement.retainedShares.toString() }
          : {}),
        heldBalance: draft.held.toString(),
        marketId: draft.marketId.toString(),
        ...(draft.market?.question
          ? { marketQuestion: draft.market.question }
          : {}),
        ...(draft.market
          ? {
              marketStatus: draft.market
                .status as PortfolioPositionResponse["marketStatus"],
            }
          : {}),
        outcomeToken: draft.outcomeToken,
        ownedTotal: owned.toString(),
        ...(draft.pool ? { poolId: draft.pool.poolId } : {}),
        ...(priceWad !== undefined
          ? { poolPriceWad: priceWad.toString() }
          : {}),
        ...(draft.market?.resolution
          ? { resolution: draft.market.resolution }
          : {}),
        side: draft.side,
      };
    });
}

/**
 * Display price of an outcome token once its market hit a terminal event:
 * the winning side redeems at exactly one collateral unit, the losing side at
 * zero, and a cancelled draw redeems both sides at half. Returns undefined
 * while no terminal event is indexed (including a resolution row without a
 * winning side, which cannot price either side).
 */
function settledOutcomePriceWad(
  resolution: MarketResolutionResponse | null,
  side: "yes" | "no",
): bigint | undefined {
  if (!resolution) {
    return undefined;
  }

  if (resolution.kind === "cancelled") {
    return WAD / 2n;
  }

  if (!resolution.winningSide) {
    return undefined;
  }

  return side === resolution.winningSide ? WAD : 0n;
}

/**
 * Serializes one redemption payout. `valueWad` re-expresses the raw
 * collateral payout as a display-WAD value using the collateral's decimals,
 * so clients never re-derive chain-specific scaling; it is omitted when the
 * market row or its decimals read is unavailable, leaving the raw amount as
 * the paper-trail fallback.
 */
function serializeRedemption(
  row: PortfolioRedemptionRow,
  decimalsByCollateral: Map<string, number>,
): PortfolioRedemptionResponse {
  const decimals = row.market
    ? decimalsByCollateral.get(row.market.collateral)
    : undefined;

  return {
    collateralAmount: row.redemption.collateralAmount.toString(),
    kind: row.redemption.kind,
    logIndex: row.redemption.logIndex,
    marketId: row.redemption.marketId.toString(),
    ...(row.market?.question ? { marketQuestion: row.market.question } : {}),
    ...(row.redemption.noAmount !== null
      ? { noAmount: row.redemption.noAmount.toString() }
      : {}),
    ...(row.redemption.outcomeAmount !== null
      ? { outcomeAmount: row.redemption.outcomeAmount.toString() }
      : {}),
    redeemedAt: row.redemption.blockTimestamp.toISOString(),
    ...(row.redemption.side !== null ? { side: row.redemption.side } : {}),
    transactionHash: row.redemption.transactionHash,
    ...(decimals !== undefined
      ? {
          valueWad: collateralUnitsToWad(
            row.redemption.collateralAmount,
            decimals,
          ).toString(),
        }
      : {}),
    ...(row.redemption.yesAmount !== null
      ? { yesAmount: row.redemption.yesAmount.toString() }
      : {}),
  };
}

/**
 * Re-expresses a raw collateral amount as an 18-decimal display-WAD value.
 * Assumes collateral decimals ≤ 18 (true for every supported collateral;
 * a larger value would make the exponent negative and throw).
 */
function collateralUnitsToWad(amount: bigint, decimals: number): bigint {
  return amount * 10n ** BigInt(18 - decimals);
}

function aggregateSettlements(receiptRows: PortfolioReceiptRow[]) {
  const totals = new Map<
    string,
    { retainedCost: bigint; retainedShares: bigint }
  >();

  for (const row of receiptRows) {
    if (!row.graduatedClaim) {
      continue;
    }

    const side = row.placed.side === 0 ? "yes" : "no";
    const key = settlementKey(row.placed.marketId, side);
    const total = totals.get(key) ?? { retainedCost: 0n, retainedShares: 0n };

    total.retainedCost += row.graduatedClaim.retainedCost;
    total.retainedShares += row.graduatedClaim.retainedShares;
    totals.set(key, total);
  }

  return totals;
}

function settlementKey(marketId: bigint, side: "yes" | "no") {
  return `${marketId}:${side}`;
}

function serializeOpenOrders(
  orderRows: PortfolioOrderRow[],
  decimalsByCollateral: Map<string, number>,
): PortfolioOpenOrderResponse[] {
  return orderRows.flatMap((row) => {
    const decimals = row.market
      ? decimalsByCollateral.get(row.market.collateral)
      : undefined;

    // An order whose market context or collateral decimals are unavailable
    // cannot be priced faithfully; drop it rather than misquote.
    if (!row.market || decimals === undefined) {
      return [];
    }

    return [
      {
        marketId: row.pool.marketId.toString(),
        ...(row.market.question ? { marketQuestion: row.market.question } : {}),
        order: serializeVenueOrder({
          collateralDecimals: decimals,
          order: row.order,
          pool: row.pool,
        }),
      },
    ];
  });
}

function collateralAddresses(
  balanceRows: PortfolioBalanceRow[],
  orderRows: PortfolioOrderRow[],
  redemptionRows: PortfolioRedemptionRow[],
): string[] {
  const addresses = new Set<string>();

  for (const row of [...balanceRows, ...orderRows, ...redemptionRows]) {
    if (row.market) {
      addresses.add(row.market.collateral);
    }
  }

  return [...addresses];
}

async function readDecimalsBestEffort(
  dependencies: PortfolioReadDependencies,
  collaterals: string[],
): Promise<Map<string, number>> {
  const decimals = new Map<string, number>();

  await Promise.all(
    collaterals.map(async (collateral) => {
      try {
        decimals.set(
          collateral,
          await dependencies.readCollateralDecimals(
            collateral as `0x${string}`,
          ),
        );
      } catch (error) {
        console.warn(
          `[Portfolio] Could not read decimals for collateral ${collateral}:`,
          error,
        );
      }
    }),
  );

  return decimals;
}

async function readPoolPricesBestEffort(
  dependencies: PortfolioReadDependencies,
  poolIds: string[],
): Promise<Map<string, bigint>> {
  if (poolIds.length === 0) {
    return new Map();
  }

  try {
    return await dependencies.readPoolSqrtPricesX96(poolIds);
  } catch (error) {
    console.warn("[Portfolio] Could not read pool prices:", error);
    return new Map();
  }
}

const defaultDependencies: PortfolioReadDependencies = {
  readCollateralDecimals,
  readPoolSqrtPricesX96,
  selectOwnerBalances: async ({ chainId, owner }) => {
    const rows = await db
      .select({
        balance: schema.outcomeTokenBalances,
        market: schema.markets,
        metadata: schema.marketMetadata,
        pool: schema.venuePools,
        resolution: schema.postgradResolutionEvents,
      })
      .from(schema.outcomeTokenBalances)
      .leftJoin(
        schema.venuePools,
        and(
          eq(schema.venuePools.chainId, schema.outcomeTokenBalances.chainId),
          eq(
            schema.venuePools.outcomeToken,
            schema.outcomeTokenBalances.outcomeToken,
          ),
        ),
      )
      .leftJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.outcomeTokenBalances.chainId),
          eq(schema.markets.marketId, schema.outcomeTokenBalances.marketId),
        ),
      )
      .leftJoin(
        schema.marketMetadata,
        and(
          eq(schema.marketMetadata.chainId, schema.markets.chainId),
          eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
        ),
      )
      // A market emits at most one terminal MarketResolved/MarketCancelled
      // event ever, so this join cannot fan rows out.
      .leftJoin(
        schema.postgradResolutionEvents,
        and(
          eq(
            schema.postgradResolutionEvents.chainId,
            schema.outcomeTokenBalances.chainId,
          ),
          eq(
            schema.postgradResolutionEvents.marketId,
            schema.outcomeTokenBalances.marketId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.outcomeTokenBalances.chainId, chainId),
          eq(schema.outcomeTokenBalances.owner, owner),
        ),
      );

    return rows.map((row) => ({
      balance: row.balance,
      market: row.market
        ? {
            collateral: row.market.collateral,
            question: row.metadata?.question ?? null,
            resolution: row.resolution
              ? serializeResolutionRow(row.resolution)
              : null,
            status: row.market.status,
          }
        : null,
      pool: row.pool,
    }));
  },
  selectOwnerOpenOrders: async ({ chainId, owner }) => {
    const rows = await db
      .select({
        market: schema.markets,
        metadata: schema.marketMetadata,
        order: schema.venueOrders,
        pool: schema.venuePools,
      })
      .from(schema.venueOrders)
      .innerJoin(
        schema.venuePools,
        and(
          eq(schema.venuePools.chainId, schema.venueOrders.chainId),
          eq(schema.venuePools.poolId, schema.venueOrders.poolId),
        ),
      )
      .leftJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.venuePools.chainId),
          eq(schema.markets.marketId, schema.venuePools.marketId),
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
          eq(schema.venueOrders.chainId, chainId),
          eq(schema.venueOrders.owner, owner),
          eq(schema.venueOrders.status, "open"),
        ),
      )
      .orderBy(
        desc(schema.venueOrders.createdBlockNumber),
        desc(schema.venueOrders.createdLogIndex),
      );

    return rows.map((row) => ({
      market: row.market
        ? {
            collateral: row.market.collateral,
            question: row.metadata?.question ?? null,
            status: row.market.status,
          }
        : null,
      order: row.order,
      pool: row.pool,
    }));
  },
  selectOwnerReceipts: async ({ chainId, owner }) => {
    const rows = await db
      .select({
        graduatedClaim: schema.graduatedReceiptClaimedEvents,
        market: schema.markets,
        metadata: schema.marketMetadata,
        placed: schema.receiptPlacedEvents,
        refundClaim: schema.refundedReceiptClaimedEvents,
      })
      .from(schema.receiptPlacedEvents)
      .innerJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.receiptPlacedEvents.chainId),
          eq(schema.markets.marketId, schema.receiptPlacedEvents.marketId),
        ),
      )
      .leftJoin(
        schema.marketMetadata,
        and(
          eq(schema.marketMetadata.chainId, schema.markets.chainId),
          eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
        ),
      )
      .leftJoin(
        schema.graduatedReceiptClaimedEvents,
        and(
          eq(
            schema.graduatedReceiptClaimedEvents.chainId,
            schema.receiptPlacedEvents.chainId,
          ),
          eq(
            schema.graduatedReceiptClaimedEvents.receiptId,
            schema.receiptPlacedEvents.receiptId,
          ),
        ),
      )
      .leftJoin(
        schema.refundedReceiptClaimedEvents,
        and(
          eq(
            schema.refundedReceiptClaimedEvents.chainId,
            schema.receiptPlacedEvents.chainId,
          ),
          eq(
            schema.refundedReceiptClaimedEvents.receiptId,
            schema.receiptPlacedEvents.receiptId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.receiptPlacedEvents.chainId, chainId),
          eq(schema.receiptPlacedEvents.owner, owner),
        ),
      )
      .orderBy(
        desc(schema.receiptPlacedEvents.blockNumber),
        desc(schema.receiptPlacedEvents.logIndex),
      );

    return rows.map((row) => ({
      graduatedClaim: row.graduatedClaim,
      market: {
        collateral: row.market.collateral,
        question: row.metadata?.question ?? null,
        status: row.market.status,
      },
      placed: row.placed,
      refundClaim: row.refundClaim,
    }));
  },
  selectOwnerRedemptions: async ({ chainId, owner }) => {
    const rows = await db
      .select({
        market: schema.markets,
        metadata: schema.marketMetadata,
        redemption: schema.postgradRedemptionEvents,
      })
      .from(schema.postgradRedemptionEvents)
      .leftJoin(
        schema.markets,
        and(
          eq(schema.markets.chainId, schema.postgradRedemptionEvents.chainId),
          eq(schema.markets.marketId, schema.postgradRedemptionEvents.marketId),
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
          eq(schema.postgradRedemptionEvents.chainId, chainId),
          eq(schema.postgradRedemptionEvents.account, owner),
        ),
      )
      .orderBy(
        desc(schema.postgradRedemptionEvents.blockNumber),
        desc(schema.postgradRedemptionEvents.logIndex),
      );

    return rows.map((row) => ({
      market: row.market
        ? {
            collateral: row.market.collateral,
            question: row.metadata?.question ?? null,
            status: row.market.status,
          }
        : null,
      redemption: row.redemption,
    }));
  },
};
