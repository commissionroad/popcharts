import { describe, expect, it } from "bun:test";

import { POSTGRAD_MARKET_STATUS, SIDE_NO, SIDE_YES } from "@popcharts/protocol";

import {
  chainSideVerdict,
  type MarketResolutionProposalDependencies,
  proposeMarketResolutionOnChain,
  readOnChainResolutionProposal,
  readResolverPrivateKey,
  resolutionChainAction,
} from "./chain-resolution";

const MARKET = `0x${"ab".repeat(20)}` as `0x${string}`;
const TX = `0x${"11".repeat(32)}` as `0x${string}`;

function makeDeps(
  overrides: Partial<MarketResolutionProposalDependencies> = {},
) {
  const writes: { address: `0x${string}`; side: number }[] = [];
  const deps: MarketResolutionProposalDependencies = {
    currentChainId: () => 31337,
    getLatestBlockTimestamp: async () => new Date("2026-01-01T00:00:00.000Z"),
    readMarketStatus: async () => POSTGRAD_MARKET_STATUS.trading,
    readProposedSide: async () => SIDE_YES,
    submitResolutionProposal: async (address, side) => {
      writes.push({ address, side });
      return TX;
    },
    waitForTransactionTimestamp: async () =>
      new Date("2026-01-02T00:00:00.000Z"),
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

describe("proposeMarketResolutionOnChain", () => {
  it("proposes YES on the market address when it is still trading", async () => {
    const { deps, writes } = makeDeps();

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result?.kind).toBe("proposed");
    expect(result?.transactionHash).toBe(TX);
    expect(writes).toEqual([{ address: MARKET, side: 0 }]);
  });

  it("proposes NO with side 1", async () => {
    const { deps, writes } = makeDeps();

    await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_no" },
      deps,
    );

    expect(writes).toEqual([{ address: MARKET, side: 1 }]);
  });

  // The dispute window is permissionless, so the runner is never the only actor
  // that can move a market out of Trading. Every status that already carries a
  // resolution outcome is a no-op success, not a job failure.
  it.each([
    ["a proposal is already pending", POSTGRAD_MARKET_STATUS.resolutionPending],
    ["the pending proposal is disputed", POSTGRAD_MARKET_STATUS.disputed],
    ["the market is already resolved", POSTGRAD_MARKET_STATUS.resolved],
  ])("is a no-op when %s", async (_label, status) => {
    const { deps, writes } = makeDeps({ readMarketStatus: async () => status });

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result?.kind).toBe("already_on_chain");
    expect(writes).toEqual([]);
  });

  // The caller persists this side as the audit verdict, so a no-op must report
  // what the contract holds rather than echoing back the verdict it was asked
  // for — those two disagree exactly when the audit row matters most.
  it("reports the side already on-chain, not the verdict it was asked to propose", async () => {
    const { deps, writes } = makeDeps({
      readMarketStatus: async () => POSTGRAD_MARKET_STATUS.disputed,
      readProposedSide: async () => SIDE_NO,
    });

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result).toMatchObject({
      kind: "already_on_chain",
      proposedSide: "no",
    });
    expect(writes).toEqual([]);
  });

  it("reports the side it just submitted", async () => {
    const { deps } = makeDeps();

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_no" },
      deps,
    );

    expect(result).toMatchObject({ kind: "proposed", proposedSide: "no" });
  });

  it("throws when the market is in an unexpected on-chain status", async () => {
    const { deps } = makeDeps({
      readMarketStatus: async () => POSTGRAD_MARKET_STATUS.cancelled,
    });

    await expect(
      proposeMarketResolutionOnChain(
        {
          chainId: 31337,
          postgradMarketAddress: MARKET,
          verdict: "resolve_yes",
        },
        deps,
      ),
    ).rejects.toThrow("expected 0 (Trading)");
  });

  it("throws on a chain-id mismatch", async () => {
    const { deps } = makeDeps({ currentChainId: () => 999 });

    await expect(
      proposeMarketResolutionOnChain(
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

    const result = await proposeMarketResolutionOnChain(
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

describe("chainSideVerdict", () => {
  it("maps the on-chain side back to the verdict it implies", () => {
    expect(chainSideVerdict("yes")).toBe("resolve_yes");
    expect(chainSideVerdict("no")).toBe("resolve_no");
  });
});

describe("readOnChainResolutionProposal", () => {
  it.each([
    ["a proposal is pending", POSTGRAD_MARKET_STATUS.resolutionPending],
    ["the proposal is disputed", POSTGRAD_MARKET_STATUS.disputed],
    ["the market is resolved", POSTGRAD_MARKET_STATUS.resolved],
  ])("returns the standing proposal when %s", async (_label, status) => {
    const { deps } = makeDeps({
      readMarketStatus: async () => status,
      readProposedSide: async () => SIDE_NO,
    });

    await expect(
      readOnChainResolutionProposal(
        { chainId: 31337, postgradMarketAddress: MARKET },
        deps,
      ),
    ).resolves.toEqual({
      blockTimestamp: new Date("2026-01-01T00:00:00.000Z"),
      proposedSide: "no",
    });
  });

  it.each([
    ["still trading", POSTGRAD_MARKET_STATUS.trading],
    ["cancelled", POSTGRAD_MARKET_STATUS.cancelled],
  ])("returns null when the market is %s", async (_label, status) => {
    const { deps } = makeDeps({ readMarketStatus: async () => status });

    await expect(
      readOnChainResolutionProposal(
        { chainId: 31337, postgradMarketAddress: MARKET },
        deps,
      ),
    ).resolves.toBeNull();
  });

  // The whole point of the read-only path: it is handed to a job that has been
  // told to stand down, so it must have no way to reach proposeResolution().
  it("never submits a transaction", async () => {
    const { deps, writes } = makeDeps({
      readMarketStatus: async () => POSTGRAD_MARKET_STATUS.trading,
    });

    await readOnChainResolutionProposal(
      { chainId: 31337, postgradMarketAddress: MARKET },
      deps,
    );

    expect(writes).toEqual([]);
  });

  it("throws on a chain-id mismatch", async () => {
    const { deps } = makeDeps({ currentChainId: () => 999 });

    await expect(
      readOnChainResolutionProposal(
        { chainId: 31337, postgradMarketAddress: MARKET },
        deps,
      ),
    ).rejects.toThrow("does not match");
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
