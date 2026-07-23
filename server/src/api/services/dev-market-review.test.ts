import { describe, expect, it } from "bun:test";

import type { MarketStatus } from "src/api/models/markets";
import type { schema } from "src/db/client";

import {
  forceMarketReview,
  type DevMarketReviewDependencies,
} from "./dev-market-review";

const WAD = 10n ** 18n;
const TRANSACTION_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("forceMarketReview", () => {
  it("is disabled unless dev market review is explicitly enabled", async () => {
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "7", verdict: "approve" },
      createDependencies({ devReviewEnabled: false }),
    );

    expect(result).toEqual({
      kind: "dev_disabled",
      message: "Dev market review is disabled.",
    });
  });

  it("rejects an invalid market id", async () => {
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "not-a-market", verdict: "approve" },
      createDependencies(),
    );

    expect(result).toEqual({
      kind: "invalid_market_id",
      message: "Invalid market id.",
    });
  });

  it("returns not found when the market does not exist", async () => {
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "8", verdict: "approve" },
      createDependencies(),
    );

    expect(result).toEqual({
      kind: "not_found",
      message: "Market not found.",
    });
  });

  it("rejects a market that is not under review before touching the chain", async () => {
    const calls: string[] = [];
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "7", verdict: "approve" },
      createDependencies({
        calls,
        market: createMarketRow({ status: "bootstrap" }),
      }),
    );

    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      kind: "ineligible",
      message:
        "Market is bootstrap; only under-review markets can be force-reviewed.",
      reason: "wrong_status",
    });
  });

  it("approves on-chain before inserting the forced review", async () => {
    const calls: string[] = [];
    const persisted: Parameters<
      DevMarketReviewDependencies["persistForcedReview"]
    >[0][] = [];
    const result = await forceMarketReview(
      {
        chainId: 31337,
        marketId: "7",
        reasons: ["Known-good fixture."],
        verdict: "approve",
      },
      createDependencies({ calls, persisted }),
    );

    expect(calls).toEqual(["transition:bootstrap", "persist"]);
    expect(result).toMatchObject({
      kind: "reviewed",
      transactionHash: TRANSACTION_HASH,
      verdict: "approve",
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      chainId: 31337,
      marketId: 7n,
      result: {
        evidence: [],
        hardFlags: [],
        promptVersion: "dev-force-review",
        provider: "heuristic",
        reasons: ["Known-good fixture."],
        sourceChecks: [],
        verdict: "approve",
      },
    });
    expect(persisted[0]?.reviewedAt).toBeInstanceOf(Date);
  });

  it("rejects on-chain and inserts the default rejected review", async () => {
    const calls: string[] = [];
    const persisted: Parameters<
      DevMarketReviewDependencies["persistForcedReview"]
    >[0][] = [];
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "7", verdict: "reject" },
      createDependencies({ calls, persisted }),
    );

    expect(calls).toEqual(["transition:rejected", "persist"]);
    expect(result).toMatchObject({
      kind: "reviewed",
      transactionHash: TRANSACTION_HASH,
      verdict: "reject",
    });
    expect(persisted[0]?.result.reasons).toEqual([
      "This market was rejected by the dev review harness.",
    ]);
  });

  it("parks a manual review without touching the chain", async () => {
    const calls: string[] = [];
    const persisted: Parameters<
      DevMarketReviewDependencies["persistForcedReview"]
    >[0][] = [];
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "7", verdict: "manual_review" },
      createDependencies({ calls, persisted }),
    );

    expect(calls).toEqual(["persist"]);
    expect(result).toMatchObject({
      kind: "reviewed",
      verdict: "manual_review",
    });
    expect(persisted[0]?.result.reasons).toEqual([
      "Parked for manual review by the dev harness.",
    ]);
  });

  it("surfaces a contract lifecycle mismatch without persisting", async () => {
    const calls: string[] = [];
    const result = await forceMarketReview(
      { chainId: 31337, marketId: "7", verdict: "approve" },
      createDependencies({
        calls,
        transitionOnChain: async () => {
          calls.push("transition:bootstrap");
          throw new Error(
            "Market 7 has contract status 0; expected 7 before review transition.",
          );
        },
      }),
    );

    expect(calls).toEqual(["transition:bootstrap"]);
    expect(result).toMatchObject({
      kind: "ineligible",
      message:
        "Market 7 has contract status 0; expected 7 before review transition.",
      reason: "chain_status",
    });
  });
});

function createDependencies({
  calls = [],
  devReviewEnabled = true,
  market = createMarketRow(),
  persisted = [],
  transitionOnChain = async ({ targetMarketStatus }) => {
    calls.push(`transition:${targetMarketStatus}`);
    return {
      blockTimestamp: new Date("2026-06-22T16:00:00.000Z"),
      kind: "transitioned" as const,
      transactionHash: TRANSACTION_HASH,
    };
  },
}: {
  calls?: string[];
  devReviewEnabled?: boolean;
  market?: MarketRow;
  persisted?: Parameters<
    DevMarketReviewDependencies["persistForcedReview"]
  >[0][];
  transitionOnChain?: DevMarketReviewDependencies["transitionOnChain"];
} = {}): DevMarketReviewDependencies {
  return {
    devReviewEnabled: () => devReviewEnabled,
    persistForcedReview: async (input) => {
      calls.push("persist");
      persisted.push(input);
    },
    selectMarket: async ({ chainId, marketId }) =>
      chainId === market.chainId && marketId === market.marketId
        ? { market, metadata: null }
        : null,
    transitionOnChain,
  };
}

type MarketRow = typeof schema.markets.$inferSelect;

function createMarketRow(
  overrides: Partial<MarketRow> & { status?: MarketStatus } = {},
): MarketRow {
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
    noShares: 0n,
    openingProbabilityWad: WAD / 2n,
    receiptCount: 0n,
    resolutionTime: new Date("2026-07-22T15:00:00.000Z"),
    status: "under_review",
    totalEscrowed: 0n,
    updatedAt: new Date("2026-06-22T15:00:00.000Z"),
    yesNotBefore: null,
    yesShares: 0n,
    ...overrides,
  };
}
