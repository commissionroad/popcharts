import { describe, expect, it } from "bun:test";

import type { MarketStatus } from "src/api/models/markets";
import {
  marketReviewChainAction,
  readReviewManagerPrivateKey,
  transitionReviewedMarketOnChain,
  type MarketReviewChainTransitionDependencies,
  type ReviewTransitionFunctionName,
} from "./chain-review";

const transactionHash =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

describe("marketReviewChainAction", () => {
  for (const [status, action] of [
    ["bootstrap", { functionName: "approveMarket", targetStatus: 0 }],
    ["rejected", { functionName: "rejectMarket", targetStatus: 8 }],
  ] as Array<[MarketStatus, ReturnType<typeof marketReviewChainAction>]>) {
    it(`maps ${status} to its required contract transition`, () => {
      expect(marketReviewChainAction(status)).toEqual(action);
    });
  }

  it("skips review statuses that do not change the contract", () => {
    expect(marketReviewChainAction("under_review")).toBeNull();
    expect(marketReviewChainAction("graduating")).toBeNull();
  });
});

describe("transitionReviewedMarketOnChain", () => {
  it("writes the approval transaction before returning a transition", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies({
      readMarketStatus: async () => {
        calls.push("read");
        return 7;
      },
      waitForTransactionTimestamp: async () => {
        calls.push("wait");
        return new Date("2026-07-03T15:00:00.000Z");
      },
      writeReviewTransition: async (functionName, marketId) => {
        calls.push(`${functionName}:${marketId.toString()}`);
        return transactionHash;
      },
    });

    await expect(
      transitionReviewedMarketOnChain(
        {
          chainId: 31337,
          marketId: 6n,
          targetMarketStatus: "bootstrap",
        },
        dependencies,
      ),
    ).resolves.toEqual({
      blockTimestamp: new Date("2026-07-03T15:00:00.000Z"),
      kind: "transitioned",
      transactionHash,
    });
    expect(calls).toEqual(["read", "approveMarket:6", "wait"]);
  });

  it("treats an already-transitioned contract as success", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies({
      getLatestBlockTimestamp: async () => {
        calls.push("latest");
        return new Date("2026-07-03T15:01:00.000Z");
      },
      readMarketStatus: async () => {
        calls.push("read");
        return 0;
      },
      writeReviewTransition: async () => {
        calls.push("write");
        return transactionHash;
      },
    });

    await expect(
      transitionReviewedMarketOnChain(
        {
          chainId: 31337,
          marketId: 6n,
          targetMarketStatus: "bootstrap",
        },
        dependencies,
      ),
    ).resolves.toEqual({
      blockTimestamp: new Date("2026-07-03T15:01:00.000Z"),
      kind: "already_transitioned",
    });
    expect(calls).toEqual(["read", "latest"]);
  });

  it("rejects mismatched chain ids before writing", async () => {
    const dependencies = createDependencies({
      currentChainId: () => 31337,
    });

    await expect(
      transitionReviewedMarketOnChain(
        {
          chainId: 5042002,
          marketId: 6n,
          targetMarketStatus: "bootstrap",
        },
        dependencies,
      ),
    ).rejects.toThrow(
      "Review job chain 5042002 does not match configured chain 31337.",
    );
  });

  it("rejects contract statuses that are no longer under review", async () => {
    const dependencies = createDependencies({
      readMarketStatus: async () => 2,
    });

    await expect(
      transitionReviewedMarketOnChain(
        {
          chainId: 31337,
          marketId: 6n,
          targetMarketStatus: "bootstrap",
        },
        dependencies,
      ),
    ).rejects.toThrow(
      "Market 6 has contract status 2; expected 7 before review transition.",
    );
  });
});

describe("readReviewManagerPrivateKey", () => {
  it("prefers the dedicated review manager private key", () => {
    expect(
      readReviewManagerPrivateKey(
        {
          POPCHARTS_DEPLOYER_PRIVATE_KEY:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY:
            "0x3333333333333333333333333333333333333333333333333333333333333333",
        },
        "arcTestnet",
      ),
    ).toBe(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
    );
  });

  it("falls back to the local development key only on local networks", () => {
    expect(readReviewManagerPrivateKey({}, "local")).toBe(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    expect(() => readReviewManagerPrivateKey({}, "arcTestnet")).toThrow(
      "A review manager private key is required for market review transitions.",
    );
  });
});

function createDependencies(
  overrides: Partial<MarketReviewChainTransitionDependencies> = {},
): MarketReviewChainTransitionDependencies {
  return {
    currentChainId: () => 31337,
    getLatestBlockTimestamp: async () => new Date("2026-07-03T15:02:00.000Z"),
    readMarketStatus: async () => 7,
    waitForTransactionTimestamp: async () =>
      new Date("2026-07-03T15:03:00.000Z"),
    writeReviewTransition: async (
      _functionName: ReviewTransitionFunctionName,
      _marketId: bigint,
    ) => transactionHash,
    ...overrides,
  };
}
