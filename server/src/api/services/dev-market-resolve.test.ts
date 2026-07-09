import { describe, expect, it } from "bun:test";

import type { MarketPostgradResponse } from "src/api/models/markets";
import type { schema } from "src/db/client";

import {
  resolveDevMarket,
  type DevMarketResolveDependencies,
} from "./dev-market-resolve";

const WAD = 10n ** 18n;

describe("resolveDevMarket", () => {
  it("is disabled unless dev tools are explicitly enabled", async () => {
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({ devResolveEnabled: false }),
    );

    expect(result).toEqual({
      kind: "dev_disabled",
      message: "Dev market resolution is disabled.",
    });
  });

  it("rejects invalid resolution sides before touching market state", async () => {
    let selectTouched = false;
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "maybe" },
      createDependencies({
        selectMarket: async () => {
          selectTouched = true;
          throw new Error("unexpected select");
        },
      }),
    );

    expect(selectTouched).toBe(false);
    expect(result).toEqual({
      kind: "invalid_side",
      message: "Resolution side must be yes or no.",
    });
  });

  it("rejects non-graduated markets before touching the chain", async () => {
    let chainTouched = false;
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({
        market: createMarketRow({ status: "bootstrap" }),
        resolveMarketOnChain: async () => {
          chainTouched = true;
          throw new Error("unexpected chain call");
        },
      }),
    );

    expect(chainTouched).toBe(false);
    expect(result).toMatchObject({
      kind: "ineligible",
      message:
        "Market is bootstrap; only graduated markets can be force-resolved.",
      reason: "wrong_status",
    });
  });

  it("requires an indexed postgrad market", async () => {
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({ postgrad: null }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: "Market has no indexed postgrad market to resolve.",
      reason: "postgrad_missing",
    });
  });

  it("marks a graduated market resolved after the contract resolve succeeds", async () => {
    const updatedAt = new Date("2026-06-22T19:00:00.000Z");
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({
        resolveMarketOnChain: async (postgradMarket, side) => {
          expect(postgradMarket).toBe(
            "0x00000000000000000000000000000000000000cd",
          );
          expect(side).toBe("yes");
          return {
            blockTimestamp: updatedAt,
            kind: "resolved",
            transactionHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            winningSide: "yes",
          };
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "resolved",
      transactionHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      winningSide: "yes",
    });

    expect(result.kind === "resolved" ? result.market.status : null).toBe(
      "resolved",
    );
    expect(result.kind === "resolved" ? result.market.updatedAt : null).toBe(
      updatedAt.toISOString(),
    );
  });

  it("responds idempotently when the market is already resolved to that side", async () => {
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "no" },
      createDependencies({
        market: createMarketRow({ status: "resolved" }),
        resolveMarketOnChain: async () => ({
          blockTimestamp: new Date("2026-06-22T19:00:00.000Z"),
          kind: "already_resolved",
          winningSide: "no",
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "resolved",
      winningSide: "no",
    });
    expect(
      result.kind === "resolved" ? "transactionHash" in result : true,
    ).toBe(false);
  });

  it("refuses to overwrite a different already resolved side", async () => {
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({
        market: createMarketRow({ status: "resolved" }),
        resolveMarketOnChain: async () => ({
          blockTimestamp: new Date("2026-06-22T19:00:00.000Z"),
          kind: "already_resolved",
          winningSide: "no",
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: "Market is already resolved NO.",
      reason: "already_resolved",
    });
  });

  it("surfaces a contract lifecycle mismatch as an ineligible resolution", async () => {
    const result = await resolveDevMarket(
      { chainId: 31337, marketId: "7", side: "yes" },
      createDependencies({
        resolveMarketOnChain: async () => ({
          kind: "wrong_status",
          status: 2,
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: "Postgrad market cannot resolve; contract status is 2.",
      reason: "chain_status",
    });
  });
});

function createDependencies({
  devResolveEnabled = true,
  market = createMarketRow(),
  postgrad = createPostgradInfo(),
  resolveMarketOnChain = async () => ({
    blockTimestamp: new Date("2026-06-22T19:00:00.000Z"),
    kind: "resolved" as const,
    transactionHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    winningSide: "yes" as const,
  }),
  selectMarket,
}: {
  devResolveEnabled?: boolean;
  market?: MarketRow;
  postgrad?: MarketPostgradResponse | null;
  resolveMarketOnChain?: DevMarketResolveDependencies["resolveMarketOnChain"];
  selectMarket?: DevMarketResolveDependencies["selectMarket"];
} = {}): DevMarketResolveDependencies {
  return {
    devResolveEnabled: () => devResolveEnabled,
    markMarketResolved: async ({ updatedAt }) => ({
      ...market,
      status: "resolved",
      updatedAt,
    }),
    resolveMarketOnChain,
    selectMarket:
      selectMarket ??
      (async ({ chainId, marketId }) =>
        chainId === market.chainId && marketId === market.marketId
          ? { market, metadata: null }
          : null),
    selectPostgradInfo: async () => postgrad,
  };
}

function createPostgradInfo(): MarketPostgradResponse {
  return {
    adapterAddress: "0x00000000000000000000000000000000000000ab",
    completeSetCount: (40_000n * WAD).toString(),
    finalizedAt: "2026-06-22T18:00:00.000Z",
    marketAddress: "0x00000000000000000000000000000000000000cd",
    refundTotal: (10n * WAD).toString(),
    retainedCostTotal: (40_000n * WAD).toString(),
    transactionHash:
      "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
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
    status: "graduated",
    totalEscrowed: 125n * WAD,
    updatedAt: new Date("2026-06-22T15:00:00.000Z"),
    yesShares: 25n * WAD,
    ...overrides,
  };
}
