import { describe, expect, it } from "bun:test";

import type { BlockchainClient } from "src/blockchain/client";
import {
  createDynamicAddressWatcher,
  type DynamicWatcherLog,
  type WatchedContract,
} from "src/indexer/watchers/dynamic-address-watcher";

const CURSOR = "TestCursor";
const TOKEN = "0x00000000000000000000000000000000000000aa";

const CONTRACT: WatchedContract = { address: TOKEN, startBlock: 100n };

function transferLog(blockNumber: bigint, logIndex: number): DynamicWatcherLog {
  return {
    address: TOKEN as `0x${string}`,
    blockHash: `0x${"22".repeat(32)}` as const,
    blockNumber,
    data: "0x" as const,
    logIndex,
    removed: false,
    topics: [],
    transactionHash: `0x${"11".repeat(32)}` as const,
    transactionIndex: 0,
  };
}

/**
 * Everything the watcher touches, faked in memory: cursor rows, the
 * discovered-contract registry, the chain client, and a chronological call
 * journal so ordering claims (subscribe-before-backfill) are assertable.
 */
function buildHarness({
  contracts = [CONTRACT],
  logs = [] as DynamicWatcherLog[],
  currentBlock = 120n,
} = {}) {
  const cursors = new Map<string, bigint>();
  const calls: string[] = [];
  const handled: DynamicWatcherLog[] = [];
  const liveHandlers: Array<(logs: DynamicWatcherLog[]) => Promise<void>> = [];
  let unwatchCount = 0;
  let failHandleLogAt: number | null = null;
  let backfillError: Error | null = null;
  let lookupStale = false;

  const known = new Map(contracts.map((c) => [c.address, c]));

  const client = {
    getBlockNumber: async () => currentBlock,
    getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(`getLogs:${args.fromBlock}-${args.toBlock}`);
      if (backfillError) {
        const error = backfillError;
        backfillError = null;
        throw error;
      }
      return logs.filter(
        (log) =>
          log.blockNumber! >= args.fromBlock &&
          log.blockNumber! <= args.toBlock,
      );
    },
    watchContractEvent: (args: {
      onLogs: (logs: DynamicWatcherLog[]) => Promise<void>;
    }) => {
      calls.push("watchContractEvent");
      liveHandlers.push(args.onLogs);
      return () => {
        unwatchCount += 1;
      };
    },
  } as unknown as BlockchainClient;

  const watcher = createDynamicAddressWatcher({
    cursorName: CURSOR,
    discoveryIntervalMs: 20,
    events: [],
    getKnownContract: (address) =>
      lookupStale ? undefined : known.get(address.toLowerCase()),
    handleLog: async (_client, log) => {
      if (handled.length === failHandleLogAt) {
        failHandleLogAt = null;
        throw new Error("db died");
      }
      handled.push(log);
    },
    label: "TestWatcher",
    refreshRegistry: async () => {
      calls.push("refreshRegistry");
      return [...known.values()];
    },
    subject: "test contract",
    tracker: {
      getLastProcessedBlock: async (address) =>
        cursors.get(address.toLowerCase()) ?? null,
      updateLastProcessedBlock: async (address, _cursor, blockNumber) => {
        calls.push(`cursor:${blockNumber}`);
        cursors.set(address.toLowerCase(), blockNumber);
      },
    },
  });

  return {
    calls,
    client,
    currentBlock,
    cursor: () => cursors.get(TOKEN) ?? null,
    setCursor: (block: bigint) => cursors.set(TOKEN, block),
    /** Registry still lists contracts, but per-address lookups miss. */
    makeLookupStale: () => {
      lookupStale = true;
    },
    emitLive: (liveLogs: DynamicWatcherLog[]) => liveHandlers.at(-1)!(liveLogs),
    failNextBackfill: (error: Error) => {
      backfillError = error;
    },
    /** Throw (once) when the Nth handled log is attempted, 0-indexed. */
    failHandleLogAt: (index: number) => {
      failHandleLogAt = index;
    },
    handled,
    unwatchCount: () => unwatchCount,
    watcher,
  };
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

describe("recover", () => {
  it("backfills from startBlock, trails per-log, and jumps to the snapshot only after a full pass", async () => {
    const h = buildHarness({
      logs: [transferLog(110n, 0), transferLog(110n, 1)],
    });

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.calls).toContain("getLogs:100-120");
    expect(h.handled).toHaveLength(2);
    // Both per-log advances trail the shared block by one; the completed
    // sweep then owns the jump to its snapshot.
    expect(h.calls.filter((c) => c.startsWith("cursor:"))).toEqual([
      "cursor:109",
      "cursor:109",
      "cursor:120",
    ]);
    expect(h.cursor()).toBe(120n);
  });

  it("leaves the whole block replayable when processing dies between two logs of one block", async () => {
    const h = buildHarness({
      logs: [transferLog(110n, 0), transferLog(110n, 1)],
    });
    // First log persists; the second throws — the crash-mid-block scenario.
    h.failHandleLogAt(1);

    await expect(h.watcher.recover(h.client, h.currentBlock)).rejects.toThrow(
      "db died",
    );

    // Cursor trails at 109, so the next sweep restarts at 110 and re-fetches
    // BOTH logs of the block — nothing from the block is skipped.
    expect(h.cursor()).toBe(109n);
    await h.watcher.recover(h.client, h.currentBlock);
    expect(h.calls).toContain("getLogs:110-120");
    expect(h.cursor()).toBe(120n);
  });

  it("resumes from cursor + 1 when a cursor exists", async () => {
    const h = buildHarness();
    h.setCursor(115n);

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.calls).toContain("getLogs:116-120");
  });

  it("advances an idle cursor to the snapshot when no logs exist", async () => {
    const h = buildHarness();

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.cursor()).toBe(120n);
  });

  it("does not query or move the cursor when already at the head", async () => {
    const h = buildHarness();
    h.setCursor(120n);

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.calls.some((c) => c.startsWith("getLogs:"))).toBe(false);
    expect(h.cursor()).toBe(120n);
  });

  it("re-refreshes the registry for an unknown address and skips without handling", async () => {
    const h = buildHarness({ logs: [transferLog(110n, 0)] });
    h.makeLookupStale();

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.handled).toHaveLength(0);
    // recover() refreshes once up front; the unknown log forces one more.
    expect(h.calls.filter((c) => c === "refreshRegistry")).toHaveLength(2);
  });
});

describe("watch", () => {
  it("subscribes before backfilling so no log can fall between snapshot and subscription", async () => {
    const h = buildHarness({ logs: [transferLog(110n, 0)] });

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      const subscribeAt = h.calls.indexOf("watchContractEvent");
      const backfillAt = h.calls.findIndex((c) => c.startsWith("getLogs:"));
      expect(subscribeAt).toBeGreaterThanOrEqual(0);
      expect(subscribeAt).toBeLessThan(backfillAt);
      expect(h.handled).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("retries the full backfill on the next discovery tick when it throws", async () => {
    const h = buildHarness();
    h.failNextBackfill(new Error("rpc hiccup"));

    const stop = h.watcher.watch(h.client);
    try {
      // First tick subscribed but the sweep failed, so the address set is not
      // marked watched; the next tick resubscribes and re-sweeps.
      await waitFor(() => h.cursor() === 120n);
      expect(
        h.calls.filter((c) => c === "watchContractEvent").length,
      ).toBeGreaterThanOrEqual(2);

      // Once a sweep completes, further ticks see an unchanged set and stay
      // quiet.
      const settled = h.calls.filter((c) => c === "watchContractEvent").length;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(h.calls.filter((c) => c === "watchContractEvent")).toHaveLength(
        settled,
      );
    } finally {
      stop();
    }
  });

  it("runs live logs through the same trailing-cursor discipline", async () => {
    const h = buildHarness();

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      await h.emitLive([transferLog(130n, 0)]);

      expect(h.handled).toHaveLength(1);
      expect(h.cursor()).toBe(129n);
    } finally {
      stop();
    }
  });

  it("tears down the subscription and discovery loop on stop", async () => {
    const h = buildHarness();

    const stop = h.watcher.watch(h.client);
    await waitFor(() => h.cursor() === 120n);
    stop();

    expect(h.unwatchCount()).toBe(1);
    const calls = h.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.calls).toHaveLength(calls);
  });
});
