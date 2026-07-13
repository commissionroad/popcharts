import { describe, expect, it } from "bun:test";

import {
  type MarketResolutionChainTransitionDependencies,
  readResolverPrivateKey,
  resolutionChainAction,
  transitionResolvedMarketOnChain,
} from "./chain-resolution";

const MARKET = `0x${"ab".repeat(20)}` as `0x${string}`;
const TX = `0x${"11".repeat(32)}` as `0x${string}`;

function makeDeps(
  overrides: Partial<MarketResolutionChainTransitionDependencies> = {},
) {
  const writes: { address: `0x${string}`; side: number }[] = [];
  const deps: MarketResolutionChainTransitionDependencies = {
    currentChainId: () => 31337,
    getLatestBlockTimestamp: async () => new Date("2026-01-01T00:00:00.000Z"),
    readMarketStatus: async () => 0,
    waitForTransactionTimestamp: async () =>
      new Date("2026-01-02T00:00:00.000Z"),
    writeResolution: async (address, side) => {
      writes.push({ address, side });
      return TX;
    },
    ...overrides,
  };

  return { deps, writes };
}

describe("resolutionChainAction", () => {
  it("maps resolve_yes to side 0 (YES) and resolve_no to side 1 (NO)", () => {
    expect(resolutionChainAction("resolve_yes")).toEqual({ side: 0 });
    expect(resolutionChainAction("resolve_no")).toEqual({ side: 1 });
  });

  it("returns null for verdicts the runner must not submit on-chain", () => {
    expect(resolutionChainAction("cancel_draw")).toBeNull();
    expect(resolutionChainAction("requeue_too_early")).toBeNull();
    expect(resolutionChainAction("manual_review")).toBeNull();
  });
});

describe("transitionResolvedMarketOnChain", () => {
  it("submits resolve(YES) on the market address when it is still trading", async () => {
    const { deps, writes } = makeDeps();

    const result = await transitionResolvedMarketOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result?.kind).toBe("transitioned");
    expect(result?.transactionHash).toBe(TX);
    expect(writes).toEqual([{ address: MARKET, side: 0 }]);
  });

  it("submits resolve(NO) with side 1", async () => {
    const { deps, writes } = makeDeps();

    await transitionResolvedMarketOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_no" },
      deps,
    );

    expect(writes).toEqual([{ address: MARKET, side: 1 }]);
  });

  it("is a no-op when the market is already resolved", async () => {
    const { deps, writes } = makeDeps({ readMarketStatus: async () => 1 });

    const result = await transitionResolvedMarketOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result?.kind).toBe("already_transitioned");
    expect(writes).toEqual([]);
  });

  it("throws when the market is in an unexpected on-chain status", async () => {
    const { deps } = makeDeps({ readMarketStatus: async () => 2 });

    await expect(
      transitionResolvedMarketOnChain(
        {
          chainId: 31337,
          postgradMarketAddress: MARKET,
          verdict: "resolve_yes",
        },
        deps,
      ),
    ).rejects.toThrow("expected 0");
  });

  it("throws on a chain-id mismatch", async () => {
    const { deps } = makeDeps({ currentChainId: () => 999 });

    await expect(
      transitionResolvedMarketOnChain(
        {
          chainId: 31337,
          postgradMarketAddress: MARKET,
          verdict: "resolve_yes",
        },
        deps,
      ),
    ).rejects.toThrow("does not match");
  });

  it("returns null and touches nothing for a parked verdict", async () => {
    const { deps, writes } = makeDeps({
      readMarketStatus: async () => {
        throw new Error("status should not be read for a parked verdict");
      },
    });

    const result = await transitionResolvedMarketOnChain(
      {
        chainId: 31337,
        postgradMarketAddress: MARKET,
        verdict: "manual_review",
      },
      deps,
    );

    expect(result).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("readResolverPrivateKey", () => {
  const LOCAL =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  it("prefers the explicit resolver key", () => {
    const key = `0x${"cd".repeat(32)}` as `0x${string}`;
    expect(
      readResolverPrivateKey({ POPCHARTS_RESOLVER_PRIVATE_KEY: key }, "local"),
    ).toBe(key);
  });

  it("falls back to the local default on the local network", () => {
    expect(readResolverPrivateKey({}, "local")).toBe(LOCAL);
  });

  it("throws when no key is available off the local network", () => {
    expect(() => readResolverPrivateKey({}, "arcTestnet")).toThrow(
      "resolver private key is required",
    );
  });

  it("rejects a malformed key", () => {
    expect(() =>
      readResolverPrivateKey(
        { POPCHARTS_RESOLVER_PRIVATE_KEY: "0xnothex" },
        "local",
      ),
    ).toThrow("32-byte hex");
  });
});
