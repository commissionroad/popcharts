import { POSTGRAD_MARKET_STATUS } from "@popcharts/protocol";
import { describe, expect, it } from "bun:test";

import type { TrackedPendingResolutionMarket } from "./discovery";
import {
  runResolutionFinalizePass,
  type ResolutionFinalizeDependencies,
} from "./resolution-finalize";

const POSTGRAD_MARKET = `0x${"cd".repeat(20)}` as `0x${string}`;
const TX = `0x${"22".repeat(32)}` as `0x${string}`;
const DEADLINE = 1_800_000_000n;

const market: TrackedPendingResolutionMarket = {
  chainId: 31337,
  key: "finalize:31337:7",
  label: "market 31337:7",
  marketId: 7n,
  postgradMarket: POSTGRAD_MARKET,
};

// The pass only ever touches the chain, so the clients are never reached: every
// test injects dependencies. `as never` keeps the fixture honest — a code path
// that fell through to the real clients would throw rather than silently pass.
const clients = {
  publicClient: undefined as never,
  walletClient: undefined as never,
};

function makeDeps(overrides: Partial<ResolutionFinalizeDependencies> = {}) {
  const finalizeCalls: `0x${string}`[] = [];
  const statuses: number[] = [];
  const deps: ResolutionFinalizeDependencies = {
    getLatestBlockTimestamp: async () => DEADLINE,
    readDisputeDeadline: async () => DEADLINE,
    readMarketStatus: async () => {
      statuses.push(POSTGRAD_MARKET_STATUS.resolutionPending);
      return POSTGRAD_MARKET_STATUS.resolutionPending;
    },
    submitFinalize: async (address) => {
      finalizeCalls.push(address);
      return TX;
    },
    waitForSuccessfulReceipt: async () => {},
    ...overrides,
  };

  return { deps, finalizeCalls, statuses };
}

/** A status reader that answers differently on the first and later calls. */
function statusSequence(...values: number[]) {
  let index = 0;

  return async () => values[Math.min(index++, values.length - 1)]!;
}

describe("runResolutionFinalizePass", () => {
  it("finalizes a pending proposal once the chain reaches the deadline", async () => {
    const { deps, finalizeCalls } = makeDeps();

    const outcome = await runResolutionFinalizePass({
      clients,
      dependencies: deps,
      market,
    });

    expect(outcome).toEqual({ kind: "finalized", transactionHash: TX });
    expect(finalizeCalls).toEqual([POSTGRAD_MARKET]);
  });

  it("leaves an open window alone", async () => {
    const { deps, finalizeCalls } = makeDeps({
      getLatestBlockTimestamp: async () => DEADLINE - 1n,
    });

    const outcome = await runResolutionFinalizePass({
      clients,
      dependencies: deps,
      market,
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "window_open" });
    expect(finalizeCalls).toEqual([]);
  });

  // Every one of these is another actor doing something legitimate, so none of
  // them may surface as a keeper error.
  it.each([
    ["resolved", POSTGRAD_MARKET_STATUS.resolved, "already_resolved"],
    ["disputed", POSTGRAD_MARKET_STATUS.disputed, "disputed"],
    ["cancelled", POSTGRAD_MARKET_STATUS.cancelled, "no_pending_proposal"],
    ["still trading", POSTGRAD_MARKET_STATUS.trading, "no_pending_proposal"],
  ] as const)("skips a market that is %s", async (_label, status, reason) => {
    const { deps, finalizeCalls } = makeDeps({
      readDisputeDeadline: async () => {
        // disputeDeadline() reverts without a live proposal; reading it here
        // would be a real bug, not just a wasted call.
        throw new Error("deadline should not be read without a proposal");
      },
      readMarketStatus: async () => status,
    });

    const outcome = await runResolutionFinalizePass({
      clients,
      dependencies: deps,
      market,
    });

    expect(outcome).toEqual({ kind: "skipped", reason });
    expect(finalizeCalls).toEqual([]);
  });

  it("swallows a lost race with another public finalizer", async () => {
    const { deps } = makeDeps({
      readMarketStatus: statusSequence(
        POSTGRAD_MARKET_STATUS.resolutionPending,
        POSTGRAD_MARKET_STATUS.resolved,
      ),
      submitFinalize: async () => {
        throw new Error("execution reverted: InvalidStatus");
      },
    });

    const outcome = await runResolutionFinalizePass({
      clients,
      dependencies: deps,
      market,
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "already_resolved" });
  });

  it("swallows a last-second dispute that reverts the finalize receipt", async () => {
    const { deps } = makeDeps({
      readMarketStatus: statusSequence(
        POSTGRAD_MARKET_STATUS.resolutionPending,
        POSTGRAD_MARKET_STATUS.disputed,
      ),
      waitForSuccessfulReceipt: async () => {
        throw new Error("finalizeResolution transaction failed");
      },
    });

    const outcome = await runResolutionFinalizePass({
      clients,
      dependencies: deps,
      market,
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "disputed" });
  });

  it("rethrows when the write fails and the proposal is still pending", async () => {
    const { deps } = makeDeps({
      submitFinalize: async () => {
        throw new Error("nonce too low");
      },
    });

    await expect(
      runResolutionFinalizePass({ clients, dependencies: deps, market }),
    ).rejects.toThrow("nonce too low");
  });
});
