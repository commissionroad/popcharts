import { describe, expect, it, spyOn } from "bun:test";

import type { BlockchainClient } from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";
import {
  recoverReviewBondEvents,
  watchReviewBondEvents,
} from "src/indexer/watchers/review-bond";

const VAULT = "0x00000000000000000000000000000000000000AB";

/** Chain client stub that only journals which RPC surfaces were touched. */
function buildClient() {
  const calls: string[] = [];
  let watchedAddresses: string[] = [];

  const client = {
    getBlockNumber: async () => {
      calls.push("getBlockNumber");
      return 120n;
    },
    getLogs: async () => {
      calls.push("getLogs");
      return [];
    },
    watchEvent: (args: { address: `0x${string}`[] }) => {
      calls.push("watchEvent");
      watchedAddresses = args.address;
      return () => {};
    },
  } as unknown as BlockchainClient;

  return { calls, client, watchedAddresses: () => watchedAddresses };
}

async function waitFor(check: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// The hermetic test env (test-setup.ts) deliberately leaves the vault address
// unset, so these tests exercise the exact unconfigured state a fresh
// deployment runs in. The recover test doubles as a no-DB proof: an empty
// contract set must return before the cursor tracker, whose connection string
// is pinned to a dead port and would throw.
describe("review-bond watcher with an unconfigured vault address", () => {
  it("skips recovery without fetching logs or touching cursors", async () => {
    expect(config.contracts.reviewBondVault).toBe(ZERO_ADDRESS);
    const { calls, client } = buildClient();
    const logs = spyOn(console, "log").mockImplementation(() => {});

    try {
      await recoverReviewBondEvents(client, 120n);

      expect(calls).toEqual([]);
      expect(logs.mock.calls).toContainEqual([
        "[ReviewBond] No review bond vaults known; skipping",
      ]);
    } finally {
      logs.mockRestore();
    }
  });

  it("subscribes to nothing when watching", async () => {
    expect(config.contracts.reviewBondVault).toBe(ZERO_ADDRESS);
    const { calls, client } = buildClient();

    const stop = watchReviewBondEvents(client);
    try {
      // The first discovery tick has finished deciding once it reads the head.
      await waitFor(() => calls.includes("getBlockNumber"));

      expect(calls).not.toContain("watchEvent");
      expect(calls).not.toContain("getLogs");
    } finally {
      stop();
    }
  });
});

describe("review-bond watcher with a configured vault address", () => {
  it("subscribes to the vault (positive control for the guard)", async () => {
    const original = config.contracts.reviewBondVault;
    config.contracts.reviewBondVault = VAULT;
    const { calls, client, watchedAddresses } = buildClient();
    // The tick's sweep then hits the dead test DB for its cursor; that error
    // is caught and logged by the discovery loop and is not under test here.
    const errors = spyOn(console, "error").mockImplementation(() => {});

    const stop = watchReviewBondEvents(client);
    try {
      await waitFor(() => calls.includes("watchEvent"));
      expect(watchedAddresses()).toEqual([VAULT.toLowerCase()]);

      // Drain the tick before restoring the spy: its dead-DB error must land
      // inside the mocked window, not bleed into another test's output.
      await waitFor(() => errors.mock.calls.length > 0, 4_000);
    } finally {
      stop();
      config.contracts.reviewBondVault = original;
      errors.mockRestore();
    }
  });
});
