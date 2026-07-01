import { describe, expect, it } from "bun:test";

import type { schema } from "src/db/client";

import {
  closePregradMarketForRefund,
  type DevMarketCloseDependencies,
} from "./dev-market-close";

const WAD = 10n ** 18n;

describe("closePregradMarketForRefund", () => {
  it("is disabled unless dev market close is explicitly enabled", async () => {
    const result = await closePregradMarketForRefund(
      { chainId: 31337, marketId: "7" },
      createDependencies({ devCloseEnabled: false }),
    );

    expect(result).toEqual({
      kind: "dev_disabled",
      message: "Dev market close is disabled.",
    });
  });

  it("rejects non-bootstrap markets before touching the chain", async () => {
    let chainTouched = false;
    const result = await closePregradMarketForRefund(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        closeMarketOnChain: async () => {
          chainTouched = true;
          throw new Error("unexpected chain call");
        },
        market: createMarketRow({ status: "graduating" }),
      }),
    );

    expect(chainTouched).toBe(false);
    expect(result).toMatchObject({
      kind: "ineligible",
      message:
        "Market is graduating; only bootstrap markets can be closed for dev refunds.",
      reason: "wrong_status",
    });
  });

  it("marks a bootstrap market refunded after the contract close succeeds", async () => {
    const updatedAt = new Date("2026-06-22T16:00:00.000Z");
    const result = await closePregradMarketForRefund(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        closeMarketOnChain: async () => ({
          blockTimestamp: updatedAt,
          kind: "closed",
          transactionHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "closed",
      refundAvailable: (125n * WAD).toString(),
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result.kind === "closed" ? result.market.status : null).toBe(
      "refunded",
    );
    expect(result.kind === "closed" ? result.market.updatedAt : null).toBe(
      updatedAt.toISOString(),
    );
  });

  it("surfaces a contract lifecycle mismatch as an ineligible close", async () => {
    const result = await closePregradMarketForRefund(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        closeMarketOnChain: async () => ({
          kind: "wrong_status",
          status: 2,
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: "Market is not active on-chain; contract status is 2.",
      reason: "chain_status",
    });
  });
});

function createDependencies({
  closeMarketOnChain = async () => ({
    blockTimestamp: new Date("2026-06-22T16:00:00.000Z"),
    kind: "closed" as const,
    transactionHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }),
  devCloseEnabled = true,
  market = createMarketRow(),
}: {
  closeMarketOnChain?: DevMarketCloseDependencies["closeMarketOnChain"];
  devCloseEnabled?: boolean;
  market?: MarketRow;
} = {}): DevMarketCloseDependencies {
  return {
    closeMarketOnChain,
    devCloseEnabled: () => devCloseEnabled,
    markMarketRefunded: async ({ updatedAt }) => ({
      ...market,
      status: "refunded",
      updatedAt,
    }),
    getMatchedMarketCap: async (market) =>
      market.yesShares < market.noShares ? market.yesShares : market.noShares,
    selectMarket: async ({ chainId, marketId }) =>
      chainId === market.chainId && marketId === market.marketId
        ? { market, metadata: null }
        : null,
  };
}

type MarketRow = typeof schema.markets.$inferSelect;

function createMarketRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    bypassAiResolution: false,
    chainId: 31337,
    collateral: "0x0000000000000000000000000000000000000001",
    contractId: 1,
    createdAt: new Date("2026-06-22T15:00:00.000Z"),
    createdBlockNumber: 10n,
    createdBlockTimestamp: new Date("2026-06-22T15:00:00.000Z"),
    createdLogIndex: 2,
    createdTransactionHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    creator: "0x0000000000000000000000000000000000000002",
    graduationThreshold: 40_000n * WAD,
    graduationTime: new Date("2026-06-23T15:00:00.000Z"),
    id: 12,
    liquidityParameter: 5_000n * WAD,
    marketId: 7n,
    metadataHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    noShares: 25n * WAD,
    openingProbabilityWad: WAD / 2n,
    receiptCount: 2n,
    resolutionTime: new Date("2026-07-22T15:00:00.000Z"),
    status: "bootstrap",
    totalEscrowed: 125n * WAD,
    updatedAt: new Date("2026-06-22T15:00:00.000Z"),
    yesShares: 25n * WAD,
    ...overrides,
  };
}
