import { describe, expect, it } from "bun:test";

import type { MarketPostgradResponse } from "src/api/models/markets";
import type { schema } from "src/db/client";

import {
  graduateDevMarket,
  type DevMarketGraduateDependencies,
} from "./dev-market-graduate";

const WAD = 10n ** 18n;

describe("graduateDevMarket", () => {
  it("is disabled unless dev tools are explicitly enabled", async () => {
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({ devGraduateEnabled: false }),
    );

    expect(result).toEqual({
      kind: "dev_disabled",
      message: "Dev market graduation is disabled.",
    });
  });

  it("rejects settled markets before touching the chain", async () => {
    let chainTouched = false;
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        graduateMarketOnChain: async () => {
          chainTouched = true;
          throw new Error("unexpected chain call");
        },
        market: createMarketRow({ status: "refunded" }),
      }),
    );

    expect(chainTouched).toBe(false);
    expect(result).toMatchObject({
      kind: "ineligible",
      reason: "wrong_status",
    });
  });

  it("requires a configured postgrad adapter", async () => {
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({ postgradAdapterConfigured: false }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      reason: "adapter_unconfigured",
    });
  });

  it("reports a market past its graduation deadline as ineligible", async () => {
    const deadline = new Date("2026-06-23T15:00:00.000Z");
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        graduateMarketOnChain: async () => ({
          deadline,
          kind: "past_deadline",
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: `Market passed its graduation deadline at ${deadline.toISOString()}; close it for refunds instead.`,
      reason: "past_deadline",
    });
  });

  it("returns the graduated market, postgrad handoff, and summary", async () => {
    const graduatedRow = createMarketRow({
      status: "graduated",
      totalEscrowed: 10n * WAD,
    });
    let selectCount = 0;
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        graduateMarketOnChain: async () => ({
          finalized: {
            blockTimestamp: new Date("2026-06-22T18:00:00.000Z"),
            completeSetCount: 40_000n * WAD,
            matchedMarketCap: 40_000n * WAD,
            refundTotal: 10n * WAD,
            retainedCostTotal: 40_000n * WAD,
          },
          kind: "graduated",
          transactionHashes: [
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ],
        }),
        selectMarket: async () => {
          selectCount += 1;
          return {
            market: selectCount > 1 ? graduatedRow : createMarketRow(),
            metadata: null,
          };
        },
      }),
    );

    expect(result.kind).toBe("graduated");

    if (result.kind !== "graduated") {
      throw new Error("expected graduated result");
    }

    expect(result.market.status).toBe("graduated");
    expect(result.postgrad.marketAddress).toBe(
      "0x00000000000000000000000000000000000000cd",
    );
    expect(result.summary.matchedMarketCap).toBe((40_000n * WAD).toString());
    expect(result.summary.refundedCollateral).toBe((10n * WAD).toString());
    expect(result.summary.totalEscrowed).toBe(
      (40_000n * WAD + 10n * WAD).toString(),
    );
    expect(result.transactionHashes).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("merges wired venue pools into the postgrad handoff", async () => {
    const venue = {
      boundedHookAddress: "0x00000000000000000000000000000000000000f1",
      live: true,
      noPool: {
        initialized: true,
        outcomeTokenAddress: "0x00000000000000000000000000000000000000f3",
        poolId: `0x${"22".repeat(32)}`,
        whitelisted: true,
      },
      orderManagerAddress: "0x00000000000000000000000000000000000000f2",
      poolManagerAddress: "0x00000000000000000000000000000000000000f0",
      yesPool: {
        initialized: true,
        outcomeTokenAddress: "0x00000000000000000000000000000000000000f4",
        poolId: `0x${"11".repeat(32)}`,
        whitelisted: true,
      },
    };
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        market: createMarketRow({ status: "graduated" }),
        wireVenue: async () => ({
          transactionHashes: [
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ],
          venue,
        }),
      }),
    );

    if (result.kind !== "graduated") {
      throw new Error("expected graduated result");
    }

    expect(result.postgrad.venue).toEqual(venue);
    expect(result.transactionHashes).toContain(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  it("responds idempotently for a market the chain already graduated", async () => {
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        graduateMarketOnChain: async () => ({ kind: "already_graduated" }),
        market: createMarketRow({ status: "graduated" }),
      }),
    );

    expect(result).toMatchObject({
      kind: "graduated",
      transactionHashes: [],
    });
  });

  it("surfaces a contract lifecycle mismatch as an ineligible graduation", async () => {
    const result = await graduateDevMarket(
      { chainId: 31337, marketId: "7" },
      createDependencies({
        graduateMarketOnChain: async () => ({
          kind: "wrong_status",
          status: 4,
        }),
      }),
    );

    expect(result).toMatchObject({
      kind: "ineligible",
      message: "Market cannot graduate on-chain; contract status is 4.",
      reason: "chain_status",
    });
  });
});

function createDependencies({
  devGraduateEnabled = true,
  graduateMarketOnChain = async () => ({
    finalized: {
      blockTimestamp: new Date("2026-06-22T18:00:00.000Z"),
      completeSetCount: 40_000n * WAD,
      matchedMarketCap: 40_000n * WAD,
      refundTotal: 0n,
      retainedCostTotal: 40_000n * WAD,
    },
    kind: "graduated" as const,
    transactionHashes: [],
  }),
  market = createMarketRow(),
  postgrad = createPostgradInfo(),
  postgradAdapterConfigured = true,
  selectMarket,
  wireVenue,
}: {
  devGraduateEnabled?: boolean;
  graduateMarketOnChain?: DevMarketGraduateDependencies["graduateMarketOnChain"];
  market?: MarketRow;
  postgrad?: MarketPostgradResponse;
  postgradAdapterConfigured?: boolean;
  selectMarket?: DevMarketGraduateDependencies["selectMarket"];
  wireVenue?: DevMarketGraduateDependencies["wireVenue"];
} = {}): DevMarketGraduateDependencies {
  return {
    devGraduateEnabled: () => devGraduateEnabled,
    graduateMarketOnChain,
    postgradAdapterConfigured: () => postgradAdapterConfigured,
    selectMarket:
      selectMarket ??
      (async ({ chainId, marketId }) =>
        chainId === market.chainId && marketId === market.marketId
          ? { market, metadata: null }
          : null),
    selectPostgradInfo: async () => postgrad,
    wireVenue:
      wireVenue ?? (async () => ({ transactionHashes: [], venue: null })),
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
    status: "bootstrap",
    totalEscrowed: 125n * WAD,
    updatedAt: new Date("2026-06-22T15:00:00.000Z"),
    yesShares: 25n * WAD,
    ...overrides,
  };
}
