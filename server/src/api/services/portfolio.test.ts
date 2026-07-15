import { describe, expect, it } from "bun:test";
import {
  COMPLETE_SET_PRICE_POLICY,
  displayPriceWadToSqrtPriceX96,
  sqrtPriceX96ToDisplayPriceWad,
} from "@popcharts/protocol";

import {
  getPortfolio,
  portfolioReceiptStatus,
  type PortfolioBalanceRow,
  type PortfolioOrderRow,
  type PortfolioReadDependencies,
  type PortfolioReceiptRow,
  type PortfolioRedemptionRow,
} from "src/api/services/portfolio";
import {
  venueOrderOutcomeSize,
  type VenueOrderRow,
  type VenuePoolRow,
} from "src/api/services/venue-orderbook";

const CHAIN_ID = 31337;
const OWNER = "0x00000000000000000000000000000000000000ab";
const WAD = 10n ** 18n;
const MOCK_DECIMALS = 6;
const YES_POOL_ID = `0x${"aa".repeat(32)}`;
const YES_TOKEN = "0x00000000000000000000000000000000000000e0";

describe("getPortfolio input validation", () => {
  it("rejects a malformed owner address", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: "0xnope" },
      createDependencies({}),
    );

    expect(result.kind).toBe("invalid_owner");
  });

  it("rejects an invalid chain id", async () => {
    const result = await getPortfolio(
      { chainId: Number.NaN, owner: OWNER },
      createDependencies({}),
    );

    expect(result.kind).toBe("invalid_chain");
  });

  it("lowercases the owner before querying", async () => {
    let seenOwner = "";
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER.toUpperCase().replace("0X", "0x") },
      createDependencies({
        selectOwnerReceipts: async ({ owner }) => {
          seenOwner = owner;
          return [];
        },
      }),
    );

    expect(result.kind).toBe("portfolio");
    expect(seenOwner).toBe(OWNER);
  });
});

describe("portfolioReceiptStatus", () => {
  it.each([
    ["bootstrap", "awaiting_graduation"],
    ["graduating", "awaiting_graduation"],
    ["graduated", "claimable"],
    ["resolved", "claimable"],
    ["refunded", "refund_claimable"],
    ["cancelled", "refund_claimable"],
  ])("maps an unclaimed receipt on a %s market to %s", (status, expected) => {
    const row = createReceiptRow({ marketStatus: status });

    expect(portfolioReceiptStatus(row)).toBe(expected as never);
  });

  it("maps a graduated claim to settled regardless of market status", () => {
    const row = createReceiptRow({
      graduatedClaim: {
        blockTimestamp: new Date("2026-07-05T00:00:00Z"),
        refund: 1n,
        retainedCost: 2n,
        retainedShares: 3n,
      },
      marketStatus: "graduated",
    });

    expect(portfolioReceiptStatus(row)).toBe("settled");
  });

  it("maps a refund claim to refunded", () => {
    const row = createReceiptRow({
      marketStatus: "refunded",
      refundClaim: {
        blockTimestamp: new Date("2026-07-05T00:00:00Z"),
        refund: 4n,
      },
    });

    expect(portfolioReceiptStatus(row)).toBe("refunded");
  });
});

describe("getPortfolio receipts", () => {
  it("serializes a settled receipt with its settlement result", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerReceipts: async () => [
          createReceiptRow({
            graduatedClaim: {
              blockTimestamp: new Date("2026-07-05T00:00:00Z"),
              refund: 250_000n,
              retainedCost: 600_000n,
              retainedShares: WAD,
            },
            marketStatus: "graduated",
          }),
        ],
      }),
    );

    expect(result.kind).toBe("portfolio");
    if (result.kind !== "portfolio") return;

    expect(result.portfolio.receipts).toHaveLength(1);
    expect(result.portfolio.receipts[0]).toMatchObject({
      marketQuestion: "Will it pop?",
      receiptId: "11",
      settlement: {
        refund: "250000",
        retainedCost: "600000",
        retainedShares: WAD.toString(),
      },
      side: "yes",
      status: "settled",
    });
  });

  it("maps side 1 to no and keeps the price band", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerReceipts: async () => [
          createReceiptRow({ marketStatus: "bootstrap", side: 1 }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.receipts[0]).toMatchObject({
      priceBandHigh: "620000000000000000",
      priceBandLow: "550000000000000000",
      side: "no",
      status: "awaiting_graduation",
    });
  });
});

describe("getPortfolio positions", () => {
  it("combines held balance with tokens committed in open ask orders", async () => {
    const pool = createPoolRow({});
    const askOrder = createOrderRow({ zeroForOne: true });
    const expectedCommitted = venueOrderOutcomeSize({
      liquidity: askOrder.remainingLiquidity,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      tickLower: askOrder.tickLower,
      tickUpper: askOrder.tickUpper,
    });
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, pool }),
        ],
        selectOwnerOpenOrders: async () => [
          createOrderContextRow({ order: askOrder, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions).toHaveLength(1);
    expect(result.portfolio.positions[0]).toMatchObject({
      committedInOrders: expectedCommitted.toString(),
      heldBalance: (40n * WAD).toString(),
      ownedTotal: (40n * WAD + expectedCommitted).toString(),
      side: "yes",
    });
  });

  it("ignores bid orders when computing committed tokens", async () => {
    const pool = createPoolRow({});
    // zeroForOne !== outcomeIsCurrency0 → the maker deposited collateral.
    const bidOrder = createOrderRow({ zeroForOne: false });
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, pool }),
        ],
        selectOwnerOpenOrders: async () => [
          createOrderContextRow({ order: bidOrder, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions[0]).toMatchObject({
      committedInOrders: "0",
      ownedTotal: (40n * WAD).toString(),
    });
  });

  it("creates a position from committed tokens even without a balance row", async () => {
    const pool = createPoolRow({});
    const askOrder = createOrderRow({ zeroForOne: true });
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerOpenOrders: async () => [
          createOrderContextRow({ order: askOrder, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions).toHaveLength(1);
    expect(result.portfolio.positions[0]).toMatchObject({
      heldBalance: "0",
      side: "yes",
    });
  });

  it("drops fully exited positions", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 0n, pool: createPoolRow({}) }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions).toHaveLength(0);
  });

  it("values positions at the current pool price", async () => {
    const pool = createPoolRow({});
    const sqrtPriceX96 = displayPriceWadToSqrtPriceX96({
      collateralDecimals: MOCK_DECIMALS,
      displayPriceWad: (WAD * 6n) / 10n,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
    });
    const priceWad = sqrtPriceX96ToDisplayPriceWad({
      collateralDecimals: MOCK_DECIMALS,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      sqrtPriceX96,
    });
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        readPoolSqrtPricesX96: async () =>
          new Map([[pool.poolId, sqrtPriceX96]]),
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    const expectedValue = (40n * WAD * priceWad) / WAD;
    expect(result.portfolio.positions[0]).toMatchObject({
      currentValueWad: expectedValue.toString(),
      poolPriceWad: priceWad.toString(),
    });
    expect(result.portfolio.summary.totalPositionValueWad).toBe(
      expectedValue.toString(),
    );
  });

  it("omits price and value when the pool is uninitialized", async () => {
    const pool = createPoolRow({});
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        readPoolSqrtPricesX96: async () => new Map([[pool.poolId, 0n]]),
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions[0]!.poolPriceWad).toBeUndefined();
    expect(result.portfolio.positions[0]!.currentValueWad).toBeUndefined();
    expect(result.portfolio.summary.totalPositionValueWad).toBe("0");
  });

  it("keeps positions when the venue price read fails", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        readPoolSqrtPricesX96: async () => {
          throw new Error("venue unavailable");
        },
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, pool: createPoolRow({}) }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions).toHaveLength(1);
    expect(result.portfolio.positions[0]!.currentValueWad).toBeUndefined();
  });

  it("values resolved-market positions at the settlement price, not the pool quote", async () => {
    const pool = createPoolRow({});
    const poolPrice = displayPriceWadToSqrtPriceX96({
      collateralDecimals: MOCK_DECIMALS,
      displayPriceWad: WAD / 2n,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
    });
    const market = {
      collateral: "0x0000000000000000000000000000000000000002",
      question: "Will it pop?",
      resolution: {
        kind: "resolved" as const,
        postgradMarket: "0x00000000000000000000000000000000000000f0",
        resolvedAt: "2026-07-10T00:00:00.000Z",
        transactionHash: `0x${"dd".repeat(32)}`,
        winningSide: "yes" as const,
      },
      status: "resolved",
    };
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        readPoolSqrtPricesX96: async () => new Map([[pool.poolId, poolPrice]]),
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: 40n * WAD, market, pool }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    // Winning side: worth exactly 1 collateral per token, not the stale 0.50.
    expect(result.portfolio.positions[0]).toMatchObject({
      currentValueWad: (40n * WAD).toString(),
      poolPriceWad: WAD.toString(),
    });
  });

  it("values a cancelled draw at half and the losing side at zero", async () => {
    const pool = createPoolRow({});
    const losingResolution = {
      kind: "resolved" as const,
      postgradMarket: "0x00000000000000000000000000000000000000f0",
      resolvedAt: "2026-07-10T00:00:00.000Z",
      transactionHash: `0x${"dd".repeat(32)}`,
      winningSide: "no" as const,
    };
    const marketFor = (
      resolution: NonNullable<
        NonNullable<PortfolioBalanceRow["market"]>["resolution"]
      >,
    ) => ({
      collateral: "0x0000000000000000000000000000000000000002",
      question: "Will it pop?",
      resolution,
      status: "resolved",
    });

    const losing = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({
            balance: 40n * WAD,
            market: marketFor(losingResolution),
            pool,
          }),
        ],
      }),
    );
    const draw = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({
            balance: 40n * WAD,
            market: marketFor({
              ...losingResolution,
              kind: "cancelled",
              winningSide: undefined,
            }),
            pool,
          }),
        ],
      }),
    );

    if (losing.kind !== "portfolio" || draw.kind !== "portfolio") {
      throw new Error("expected portfolios");
    }

    expect(losing.portfolio.positions[0]?.currentValueWad).toBe("0");
    expect(draw.portfolio.positions[0]?.currentValueWad).toBe(
      (20n * WAD).toString(),
    );
  });

  it("carries market status and resolution onto resolved-market positions", async () => {
    const resolution = {
      kind: "resolved" as const,
      postgradMarket: "0x00000000000000000000000000000000000000f0",
      resolvedAt: "2026-07-10T00:00:00.000Z",
      transactionHash: `0x${"dd".repeat(32)}`,
      winningSide: "yes" as const,
    };
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({
            balance: 40n * WAD,
            market: {
              collateral: "0x0000000000000000000000000000000000000002",
              question: "Will it pop?",
              resolution,
              status: "resolved",
            },
            pool: createPoolRow({}),
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions[0]).toMatchObject({
      marketStatus: "resolved",
      resolution,
    });
  });

  it("omits market status and resolution when the market row is unknown", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({
            balance: 40n * WAD,
            market: null,
            pool: createPoolRow({}),
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions[0]?.marketStatus).toBeUndefined();
    expect(result.portfolio.positions[0]?.resolution).toBeUndefined();
  });

  it("derives avg cost from settled receipts with decimal scaling", async () => {
    // 0.6 collateral (6 decimals) retained for 1 outcome token → 0.6e18 WAD.
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerBalances: async () => [
          createBalanceRow({ balance: WAD, pool: createPoolRow({}) }),
        ],
        selectOwnerReceipts: async () => [
          createReceiptRow({
            graduatedClaim: {
              blockTimestamp: new Date("2026-07-05T00:00:00Z"),
              refund: 0n,
              retainedCost: 600_000n,
              retainedShares: WAD,
            },
            marketStatus: "graduated",
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.positions[0]).toMatchObject({
      avgCostWad: ((WAD * 6n) / 10n).toString(),
      graduationShares: WAD.toString(),
    });
  });
});

describe("getPortfolio redemptions", () => {
  it("serializes a winning-side payout with its display-WAD value", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerRedemptions: async () => [
          createRedemptionRow({
            collateralAmount: 40_000_000n,
            outcomeAmount: 40n * WAD,
            side: "yes",
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.redemptions).toHaveLength(1);
    expect(result.portfolio.redemptions[0]).toEqual({
      collateralAmount: "40000000",
      kind: "redeemed",
      logIndex: 3,
      marketId: "7",
      marketQuestion: "Will it pop?",
      outcomeAmount: (40n * WAD).toString(),
      redeemedAt: "2026-07-12T00:00:00.000Z",
      side: "yes",
      transactionHash: `0x${"ee".repeat(32)}`,
      // 40 collateral at 6 decimals re-expressed as a display-WAD value.
      valueWad: (40n * WAD).toString(),
    });
  });

  it("serializes a cancelled-draw payout with both burn legs and no side", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerRedemptions: async () => [
          createRedemptionRow({
            collateralAmount: 10_000_000n,
            kind: "cancelled_redeemed",
            noAmount: 12n * WAD,
            yesAmount: 8n * WAD,
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.redemptions[0]).toMatchObject({
      kind: "cancelled_redeemed",
      noAmount: (12n * WAD).toString(),
      yesAmount: (8n * WAD).toString(),
    });
    expect(result.portfolio.redemptions[0]?.side).toBeUndefined();
    expect(result.portfolio.redemptions[0]?.outcomeAmount).toBeUndefined();
  });

  it("keeps the raw payout but omits value and question for an unknown market", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerRedemptions: async () => [
          createRedemptionRow({ market: null }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.redemptions[0]).toMatchObject({
      collateralAmount: "40000000",
    });
    expect(result.portfolio.redemptions[0]?.valueWad).toBeUndefined();
    expect(result.portfolio.redemptions[0]?.marketQuestion).toBeUndefined();
  });

  it("omits the value when the collateral decimals read fails", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        readCollateralDecimals: async () => {
          throw new Error("rpc unavailable");
        },
        selectOwnerRedemptions: async () => [createRedemptionRow({})],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.redemptions).toHaveLength(1);
    expect(result.portfolio.redemptions[0]?.valueWad).toBeUndefined();
  });
});

describe("getPortfolio open orders and summary", () => {
  it("annotates open orders with their market and counts them", async () => {
    const pool = createPoolRow({});
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerOpenOrders: async () => [
          createOrderContextRow({
            order: createOrderRow({ zeroForOne: true }),
            pool,
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.openOrders).toHaveLength(1);
    expect(result.portfolio.openOrders[0]).toMatchObject({
      marketId: "7",
      marketQuestion: "Will it pop?",
    });
    expect(result.portfolio.openOrders[0]!.order).toMatchObject({
      direction: "ask",
      owner: OWNER,
      status: "open",
    });
    expect(result.portfolio.summary.openOrderCount).toBe(1);
  });

  it("drops orders whose market context is missing", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerOpenOrders: async () => [
          createOrderContextRow({
            market: null,
            order: createOrderRow({ zeroForOne: true }),
            pool: createPoolRow({}),
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.openOrders).toHaveLength(0);
  });

  it("sums locked collateral over awaiting receipts only", async () => {
    const result = await getPortfolio(
      { chainId: CHAIN_ID, owner: OWNER },
      createDependencies({
        selectOwnerReceipts: async () => [
          createReceiptRow({ cost: 1_000_000n, marketStatus: "bootstrap" }),
          createReceiptRow({
            cost: 2_000_000n,
            marketStatus: "graduating",
            receiptId: 12n,
          }),
          createReceiptRow({
            cost: 4_000_000n,
            marketStatus: "graduated",
            receiptId: 13n,
          }),
        ],
      }),
    );

    if (result.kind !== "portfolio") throw new Error(result.kind);

    expect(result.portfolio.summary).toMatchObject({
      claimableReceiptCount: 1,
      lockedCollateral: "3000000",
      openReceiptCount: 2,
    });
  });
});

function createReceiptRow({
  cost = 600_000n,
  graduatedClaim = null,
  marketStatus,
  receiptId = 11n,
  refundClaim = null,
  side = 0,
}: {
  cost?: bigint;
  graduatedClaim?: PortfolioReceiptRow["graduatedClaim"];
  marketStatus: string;
  receiptId?: bigint;
  refundClaim?: PortfolioReceiptRow["refundClaim"];
  side?: number;
}): PortfolioReceiptRow {
  return {
    graduatedClaim,
    market: {
      collateral: "0x0000000000000000000000000000000000000002",
      question: "Will it pop?",
      status: marketStatus,
    },
    placed: {
      blockNumber: 900n,
      blockTimestamp: new Date("2026-07-01T00:00:00Z"),
      cost,
      logIndex: 2,
      marketId: 7n,
      rHigh: "620000000000000000",
      rLow: "550000000000000000",
      receiptId,
      shares: WAD,
      side,
    },
    refundClaim,
  };
}

function createBalanceRow({
  balance,
  market,
  pool,
}: {
  balance: bigint;
  market?: PortfolioBalanceRow["market"];
  pool: VenuePoolRow | null;
}): PortfolioBalanceRow {
  return {
    balance: {
      balance,
      marketId: 7n,
      outcomeToken: YES_TOKEN,
      side: "yes",
    },
    market:
      market === undefined
        ? {
            collateral: "0x0000000000000000000000000000000000000002",
            question: "Will it pop?",
            status: "graduated",
          }
        : market,
    pool,
  };
}

function createOrderContextRow({
  market,
  order,
  pool,
}: {
  market?: PortfolioOrderRow["market"];
  order: VenueOrderRow;
  pool: VenuePoolRow;
}): PortfolioOrderRow {
  return {
    market:
      market === undefined
        ? {
            collateral: "0x0000000000000000000000000000000000000002",
            question: "Will it pop?",
            status: "graduated",
          }
        : market,
    order,
    pool,
  };
}

function createPoolRow(overrides: Partial<VenuePoolRow>): VenuePoolRow {
  return {
    chainId: CHAIN_ID,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    id: 1,
    marketId: 7n,
    outcomeIsCurrency0: true,
    outcomeToken: YES_TOKEN,
    poolId: YES_POOL_ID,
    postgradMarket: "0x00000000000000000000000000000000000000f0",
    side: "yes",
    ...overrides,
  };
}

function createOrderRow(overrides: Partial<VenueOrderRow>): VenueOrderRow {
  return {
    amountIn: 500n * WAD,
    chainId: CHAIN_ID,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    createdBlockNumber: 1_000n,
    createdBlockTimestamp: new Date("2026-07-01T00:00:00.000Z"),
    createdLogIndex: 1,
    createdTransactionHash: `0x${"cc".repeat(32)}`,
    enablePartialFill: null,
    filledAmount0: 0n,
    filledAmount1: 0n,
    id: 1,
    indexedTick: null,
    liquidity: 1_000n * WAD,
    orderId: 1,
    owner: OWNER,
    poolId: YES_POOL_ID,
    remainingLiquidity: overrides.liquidity ?? 1_000n * WAD,
    status: "open",
    tickLower: -6960,
    tickUpper: -6900,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedBlockNumber: 1_000n,
    updatedLogIndex: 1,
    zeroForOne: true,
    ...overrides,
  };
}

function createRedemptionRow({
  collateralAmount = 40_000_000n,
  kind = "redeemed",
  market,
  noAmount = null,
  outcomeAmount = null,
  side = null,
  yesAmount = null,
}: {
  collateralAmount?: bigint;
  kind?: PortfolioRedemptionRow["redemption"]["kind"];
  market?: PortfolioRedemptionRow["market"];
  noAmount?: bigint | null;
  outcomeAmount?: bigint | null;
  side?: "yes" | "no" | null;
  yesAmount?: bigint | null;
}): PortfolioRedemptionRow {
  return {
    market:
      market === undefined
        ? {
            collateral: "0x0000000000000000000000000000000000000002",
            question: "Will it pop?",
            status: "resolved",
          }
        : market,
    redemption: {
      blockTimestamp: new Date("2026-07-12T00:00:00Z"),
      collateralAmount,
      kind,
      logIndex: 3,
      marketId: 7n,
      noAmount,
      outcomeAmount,
      side,
      transactionHash: `0x${"ee".repeat(32)}`,
      yesAmount,
    },
  };
}

function createDependencies(
  overrides: Partial<PortfolioReadDependencies>,
): PortfolioReadDependencies {
  return {
    readCollateralDecimals: async () => MOCK_DECIMALS,
    readPoolSqrtPricesX96: async () => new Map(),
    selectOwnerBalances: async () => [],
    selectOwnerOpenOrders: async () => [],
    selectOwnerReceipts: async () => [],
    selectOwnerRedemptions: async () => [],
    ...overrides,
  };
}
