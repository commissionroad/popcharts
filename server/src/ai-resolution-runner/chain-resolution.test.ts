import { describe, expect, it } from "bun:test";

import {
  completeSetBinaryMarketAbi,
  POSTGRAD_MARKET_STATUS,
} from "@popcharts/protocol";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
} from "viem";

import {
  isAlreadyProposedRevert,
  type MarketResolutionProposalDependencies,
  proposeMarketResolutionOnChain,
  readResolverPrivateKey,
  resolutionChainAction,
} from "./chain-resolution";

const MARKET = `0x${"ab".repeat(20)}` as `0x${string}`;
const TX = `0x${"11".repeat(32)}` as `0x${string}`;

/**
 * A real decoded revert, built from the generated ABI and wrapped exactly the
 * way viem's writeContract throws it: the decoded ContractFunctionRevertedError
 * sits in the CAUSE CHAIN of a ContractFunctionExecutionError, never at the
 * top (verified against viem 2.52.2's getContractError). Throwing the bare
 * inner error here would let a walk→instanceof refactor pass every test while
 * breaking against a real node.
 */
function invalidStatusRevert(actual: number) {
  const reverted = new ContractFunctionRevertedError({
    abi: [...completeSetBinaryMarketAbi],
    data: encodeErrorResult({
      abi: [...completeSetBinaryMarketAbi],
      args: [actual, POSTGRAD_MARKET_STATUS.trading],
      errorName: "InvalidStatus",
    }),
    functionName: "proposeResolution",
  });

  return new ContractFunctionExecutionError(reverted, {
    abi: [...completeSetBinaryMarketAbi],
    args: [0],
    contractAddress: MARKET,
    functionName: "proposeResolution",
  });
}

function makeDeps(
  overrides: Partial<MarketResolutionProposalDependencies> = {},
) {
  const writes: { address: `0x${string}`; side: number }[] = [];
  const deps: MarketResolutionProposalDependencies = {
    currentChainId: () => 31337,
    submitResolutionProposal: async (address, side) => {
      writes.push({ address, side });
      return TX;
    },
    waitForSuccessfulProposal: async () => {},
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
    const waited: string[] = [];
    const { deps, writes } = makeDeps({
      waitForSuccessfulProposal: async (hash) => {
        waited.push(hash);
      },
    });

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result).toMatchObject({ kind: "proposed", transactionHash: TX });
    expect(writes).toEqual([{ address: MARKET, side: 0 }]);
    // The receipt gate is what turns a broadcast into a success; a proposed
    // result without it would report success for a transaction that reverted.
    expect(waited).toEqual([TX]);
  });

  it("proposes NO with side 1", async () => {
    const { deps, writes } = makeDeps();

    await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_no" },
      deps,
    );

    expect(writes).toEqual([{ address: MARKET, side: 1 }]);
  });

  // The contract refuses a second proposal itself. The runner reads that
  // refusal out of the revert rather than predicting it with a status read,
  // which could only race the chain between the read and the write.
  it.each([
    ["a proposal is already pending", POSTGRAD_MARKET_STATUS.resolutionPending],
    ["the pending proposal is disputed", POSTGRAD_MARKET_STATUS.disputed],
    ["the market is already resolved", POSTGRAD_MARKET_STATUS.resolved],
  ])("reports already_proposed when %s", async (_label, status) => {
    const { deps } = makeDeps({
      submitResolutionProposal: async () => {
        throw invalidStatusRevert(status);
      },
    });

    const result = await proposeMarketResolutionOnChain(
      { chainId: 31337, postgradMarketAddress: MARKET, verdict: "resolve_yes" },
      deps,
    );

    expect(result).toEqual({ kind: "already_proposed" });
  });

  // Cancelled reverts through the same InvalidStatus error and is a real
  // failure. Swallowing it would mark the job succeeded for a market that can
  // never be resolved.
  it("propagates the revert when the market was cancelled", async () => {
    const { deps } = makeDeps({
      submitResolutionProposal: async () => {
        throw invalidStatusRevert(POSTGRAD_MARKET_STATUS.cancelled);
      },
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
    ).rejects.toThrow(ContractFunctionExecutionError);
  });

  it("propagates a failure that is not a revert at all", async () => {
    const { deps } = makeDeps({
      submitResolutionProposal: async () => {
        throw new Error("RPC unreachable");
      },
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
    ).rejects.toThrow("RPC unreachable");
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
      submitResolutionProposal: async () => {
        throw new Error("nothing should be submitted for a parked verdict");
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

describe("isAlreadyProposedRevert", () => {
  it.each([
    ["resolution pending", POSTGRAD_MARKET_STATUS.resolutionPending],
    ["disputed", POSTGRAD_MARKET_STATUS.disputed],
    ["resolved", POSTGRAD_MARKET_STATUS.resolved],
  ])("recognises %s as already proposed", (_label, status) => {
    expect(isAlreadyProposedRevert(invalidStatusRevert(status))).toBe(true);
  });

  it("does not recognise a cancelled market", () => {
    expect(
      isAlreadyProposedRevert(
        invalidStatusRevert(POSTGRAD_MARKET_STATUS.cancelled),
      ),
    ).toBe(false);
  });

  it("does not recognise an ordinary error", () => {
    expect(isAlreadyProposedRevert(new Error("boom"))).toBe(false);
    expect(isAlreadyProposedRevert(undefined)).toBe(false);
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
