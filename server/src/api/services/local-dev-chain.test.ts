import { describe, expect, it } from "bun:test";

import type { BlockchainClient } from "src/blockchain/client";

import {
  LocalRpcError,
  reachChainTimestamp,
  waitForChainTimestamp,
} from "./local-dev-chain";

/**
 * A chain whose clock the test drives. `tickSeconds` is how far the block
 * clock moves per simulated second of sleep: 1 models a chain producing
 * blocks in real time (arc-node mines every 200ms, so its block clock tracks
 * wall clock), and 0 models a chain that has stopped.
 */
function fakeChain({
  startSeconds,
  tickSeconds = 1,
}: {
  startSeconds: bigint;
  tickSeconds?: number;
}) {
  let chainSeconds = startSeconds;
  let elapsedMs = 0;
  const blockReads: bigint[] = [];

  const sleep = async (ms: number) => {
    elapsedMs += ms;
    chainSeconds += BigInt(Math.round((ms / 1000) * tickSeconds));
  };

  return {
    blockReads,
    client: {
      getBlock: async () => {
        blockReads.push(chainSeconds);
        return { timestamp: chainSeconds };
      },
    } as unknown as BlockchainClient,
    // Wall clock and chain clock advance together, which is the property that
    // makes waiting for a gate terminate at all.
    deps: { now: () => elapsedMs, sleep },
    elapsedMs: () => elapsedMs,
    sleep,
  };
}

/** A node that answers every `evm_*` call the way arc-node does (ADR 0028 G1). */
function noWarpRpc(calls: string[] = []) {
  return {
    calls,
    requestRpc: async (method: string) => {
      calls.push(method);
      throw new LocalRpcError("Method not found", -32601);
    },
  };
}

describe("reachChainTimestamp", () => {
  it("does not touch the chain when the gate is already open", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });
    const { calls, requestRpc } = noWarpRpc();

    const outcome = await reachChainTimestamp(chain.client, 900n, {
      label: "an open gate",
      requestRpc,
      ...chain.deps,
    });

    expect(outcome).toBe("already_passed");
    expect(calls).toEqual([]);
  });

  it("warps where the chain implements the devchain namespace", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });
    const warps: Array<[string, unknown[]]> = [];

    const outcome = await reachChainTimestamp(chain.client, 1_030n, {
      label: "a warpable gate",
      requestRpc: async (method, params) => {
        warps.push([method, params]);
      },
      ...chain.deps,
    });

    expect(outcome).toBe("warped");
    expect(warps).toEqual([["evm_setNextBlockTimestamp", [1_030]]]);
  });

  it("waits the gate out where the chain has no devchain namespace", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });
    const { calls, requestRpc } = noWarpRpc();

    const outcome = await reachChainTimestamp(chain.client, 1_030n, {
      label: "a 30s gate",
      requestRpc,
      ...chain.deps,
    });

    expect(outcome).toBe("waited");
    // One doomed probe per gate; no cached capability flag that a restarted
    // chain could invalidate.
    expect(calls).toEqual(["evm_setNextBlockTimestamp"]);
    // The wait ended on the chain's own clock, not on wall time.
    expect(chain.blockReads.at(-1)!).toBeGreaterThanOrEqual(1_030n);
  });

  it("refuses a gate further out than the wait limit instead of waiting", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });
    const { requestRpc } = noWarpRpc();

    const attempt = reachChainTimestamp(chain.client, 1_600n, {
      label: "market 7's graduation deadline",
      requestRpc,
      ...chain.deps,
    });

    // The message has to name the knob that fixes it: a market created with
    // production-sized windows cannot be rescued by any amount of waiting.
    await expect(attempt).rejects.toThrow(
      /Refusing to wait 600s for market 7's graduation deadline.*LOCAL_MARKET_GRADUATION_SECONDS/s,
    );
    expect(chain.elapsedMs()).toBe(0);
  });

  it("reports a chain that has stopped producing blocks", async () => {
    const chain = fakeChain({ startSeconds: 1_000n, tickSeconds: 0 });
    const { requestRpc } = noWarpRpc();

    await expect(
      reachChainTimestamp(chain.client, 1_030n, {
        label: "a gate on a stalled chain",
        requestRpc,
        ...chain.deps,
      }),
    ).rejects.toThrow(/not producing blocks fast enough/);
  });

  it("treats a warp rejected by a block that already passed the gate as reached", async () => {
    // The devchain refuses a timestamp at or below its latest block, so a
    // block landing between the read and the warp turns a satisfied gate into
    // an error. That race means the gate is open, not that the caller failed.
    const chain = fakeChain({ startSeconds: 1_000n });

    const outcome = await reachChainTimestamp(chain.client, 1_010n, {
      label: "a gate the chain passed mid-warp",
      requestRpc: async () => {
        await chain.sleep(20_000);
        throw new Error(
          "Timestamp 1010 is lower than or equal to previous block's timestamp",
        );
      },
      ...chain.deps,
    });

    expect(outcome).toBe("warped");
  });

  it("propagates a warp failure the chain clock does not explain", async () => {
    const chain = fakeChain({ startSeconds: 1_000n, tickSeconds: 0 });

    await expect(
      reachChainTimestamp(chain.client, 1_010n, {
        label: "a gate behind a broken RPC",
        requestRpc: async () => {
          throw new Error("connection refused");
        },
        ...chain.deps,
      }),
    ).rejects.toThrow("connection refused");
  });
});

describe("waitForChainTimestamp", () => {
  it("returns without polling when the chain clock is already past the gate", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });

    await waitForChainTimestamp(chain.client, 1_000n, {
      label: "an open gate",
      ...chain.deps,
    });

    expect(chain.blockReads).toEqual([1_000n]);
    expect(chain.elapsedMs()).toBe(0);
  });

  it("honours a wait limit widened for a scenario's own window", async () => {
    const chain = fakeChain({ startSeconds: 1_000n });

    await waitForChainTimestamp(chain.client, 1_240n, {
      label: "a 240s graduation deadline",
      waitLimitMs: 300_000,
      ...chain.deps,
    });

    expect(chain.blockReads.at(-1)!).toBeGreaterThanOrEqual(1_240n);
  });
});
