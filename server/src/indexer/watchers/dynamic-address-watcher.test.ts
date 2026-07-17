import { describe, expect, it } from "bun:test";

import type { BlockchainClient } from "src/blockchain/client";
import {
  createDynamicAddressWatcher,
  staticContractSet,
  type DynamicWatcherLog,
  type WatchedContract,
} from "src/indexer/watchers/dynamic-address-watcher";

const CURSOR = "TestCursor";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const OTHER_TOKEN = "0x00000000000000000000000000000000000000bb";

const CONTRACT: WatchedContract = { address: TOKEN, startBlock: 100n };

function transferLog(
  blockNumber: bigint,
  logIndex: number,
  address = TOKEN,
): DynamicWatcherLog {
  return {
    address: address as `0x${string}`,
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
 * journal so ordering claims (subscribe-before-sweep) are assertable.
 */
function buildHarness({
  contracts = [CONTRACT],
  logs = [] as DynamicWatcherLog[],
  currentBlock = 120n,
  fallbackStartBlock = undefined as
    ((currentBlock: bigint) => bigint) | undefined,
} = {}) {
  const cursors = new Map<string, bigint>();
  const calls: string[] = [];
  const handled: DynamicWatcherLog[] = [];
  const liveHandlers: Array<(logs: DynamicWatcherLog[]) => Promise<void>> = [];
  const chainLogs = [...logs];
  let chainHead = currentBlock;
  let unwatchCount = 0;
  let failHandleLogAt: number | null = null;
  let backfillError: Error | null = null;
  let maxLogsSpan: bigint | null = null;
  let lookupStale = false;

  const known = new Map(contracts.map((c) => [c.address, c]));

  const client = {
    getBlockNumber: async () => chainHead,
    getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(`getLogs:${args.fromBlock}-${args.toBlock}`);
      if (backfillError) {
        const error = backfillError;
        backfillError = null;
        throw error;
      }
      if (
        maxLogsSpan !== null &&
        args.toBlock - args.fromBlock + 1n > maxLogsSpan
      ) {
        throw new Error("query returned more than 10000 results");
      }
      return chainLogs.filter(
        (log) =>
          log.blockNumber! >= args.fromBlock &&
          log.blockNumber! <= args.toBlock,
      );
    },
    watchEvent: (args: {
      onLogs: (logs: DynamicWatcherLog[]) => Promise<void>;
    }) => {
      calls.push("watchEvent");
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
    fallbackStartBlock,
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
    addChainLog: (log: DynamicWatcherLog) => chainLogs.push(log),
    calls,
    client,
    currentBlock,
    cursor: (address = TOKEN) => cursors.get(address) ?? null,
    setChainHead: (block: bigint) => {
      chainHead = block;
    },
    setCursor: (block: bigint) => cursors.set(TOKEN, block),
    /** Registry still lists contracts, but per-address lookups miss. */
    makeLookupStale: () => {
      lookupStale = true;
    },
    emitLive: (liveLogs: DynamicWatcherLog[]) => liveHandlers.at(-1)!(liveLogs),
    /** Make getLogs reject any request spanning more than N blocks. */
    capLogsSpan: (span: bigint) => {
      maxLogsSpan = span;
    },
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

  it("parks the watermark below a log it had to skip instead of checkpointing past it", async () => {
    const h = buildHarness({ logs: [transferLog(110n, 0)] });
    h.makeLookupStale();

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.handled).toHaveLength(0);
    // recover() refreshes once up front; the unknown log forces one more.
    expect(h.calls.filter((c) => c === "refreshRegistry")).toHaveLength(2);
    // The skipped money event must stay above the watermark so the next
    // sweep retries it — never silently checkpointed as persisted.
    expect(h.cursor()).toBe(null);
  });

  it("sorts logs into chain order before processing and advancing watermarks", async () => {
    // Deliberately reversed: eth_getLogs order is not guaranteed, and an
    // out-of-order response must not advance the watermark past a log that
    // has not been persisted yet.
    const h = buildHarness({
      logs: [transferLog(112n, 1), transferLog(112n, 0), transferLog(110n, 0)],
    });

    await h.watcher.recover(h.client, h.currentBlock);

    expect(
      h.handled.map((log) => `${log.blockNumber}:${log.logIndex}`),
    ).toEqual(["110:0", "112:0", "112:1"]);
    expect(h.calls.filter((c) => c.startsWith("cursor:"))).toEqual([
      "cursor:109",
      "cursor:111",
      "cursor:111",
      "cursor:120",
    ]);
  });

  it("halves the sweep span until a provider-capped getLogs succeeds, then completes", async () => {
    // Provider rejects any span over 2000 blocks (result-size cap). A fixed
    // 10k chunk would retry the same too-big range forever; the adaptive
    // span must shrink until requests succeed and still cover everything.
    const h = buildHarness({
      currentBlock: 5_000n,
      logs: [transferLog(150n, 0), transferLog(4_500n, 0)],
    });
    h.capLogsSpan(2_000n);

    await h.watcher.recover(h.client, 5_000n);

    expect(h.handled).toHaveLength(2);
    expect(h.cursor()).toBe(5_000n);
    // The first attempt probed the full range and was rejected; halving then
    // found a passing size. (Failed probes may exceed the cap — regrowth
    // deliberately re-probes larger spans — so only the shape is asserted:
    // more attempts than the two a cap-free sweep would need, and full
    // coverage above.)
    const attempts = h.calls.filter((c) => c.startsWith("getLogs:"));
    expect(attempts[0]).toBe("getLogs:100-5000");
    expect(attempts.length).toBeGreaterThan(2);
  });

  it("propagates a getLogs failure at the single-block floor", async () => {
    const h = buildHarness();
    // A cap below one block is unsatisfiable — not a range-size problem.
    h.capLogsSpan(0n);

    await expect(h.watcher.recover(h.client, h.currentBlock)).rejects.toThrow(
      "query returned more than 10000 results",
    );
    expect(h.cursor()).toBe(null);
  });

  it("chunks long ranges and resumes at the last completed chunk after a failure", async () => {
    const h = buildHarness({
      currentBlock: 25_000n,
      logs: [transferLog(150n, 0), transferLog(15_000n, 0)],
    });
    // Chunk 1 (100–10099) persists its log; the chunk-2 log throws.
    h.failHandleLogAt(1);

    await expect(h.watcher.recover(h.client, 25_000n)).rejects.toThrow(
      "db died",
    );

    // Chunk 1 completed, so the watermark holds at its end block — the
    // failed chunk-2 log stays above it.
    expect(h.calls.filter((c) => c.startsWith("getLogs:"))).toEqual([
      "getLogs:100-10099",
      "getLogs:10100-20099",
    ]);
    expect(h.cursor()).toBe(10_099n);

    await h.watcher.recover(h.client, 25_000n);

    expect(h.handled).toHaveLength(2);
    expect(h.calls.filter((c) => c.startsWith("getLogs:"))).toEqual([
      "getLogs:100-10099",
      "getLogs:10100-20099",
      "getLogs:10100-20099",
      "getLogs:20100-25000",
    ]);
    expect(h.cursor()).toBe(25_000n);
  });

  it("resolves a null startBlock through fallbackStartBlock on first recovery", async () => {
    const h = buildHarness({
      contracts: [{ address: TOKEN, startBlock: null }],
      fallbackStartBlock: (currentBlock) => currentBlock - 15n,
      logs: [transferLog(110n, 0)],
    });

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.calls).toContain("getLogs:105-120");
    expect(h.handled).toHaveLength(1);
    expect(h.cursor()).toBe(120n);
  });

  it("throws loudly when a null startBlock has no fallback configured", async () => {
    const h = buildHarness({
      contracts: [{ address: TOKEN, startBlock: null }],
    });

    await expect(h.watcher.recover(h.client, h.currentBlock)).rejects.toThrow(
      "no fallbackStartBlock",
    );
    expect(h.cursor()).toBe(null);
  });

  it("coalesces contracts sharing a watermark into one getLogs and advances both", async () => {
    const other: WatchedContract = { address: OTHER_TOKEN, startBlock: 100n };
    const h = buildHarness({
      contracts: [CONTRACT, other],
      logs: [transferLog(110n, 0), transferLog(112n, 0, OTHER_TOKEN)],
    });

    await h.watcher.recover(h.client, h.currentBlock);

    expect(h.calls.filter((c) => c.startsWith("getLogs:"))).toEqual([
      "getLogs:100-120",
    ]);
    expect(h.handled).toHaveLength(2);
    expect(h.cursor()).toBe(120n);
    expect(h.cursor(OTHER_TOKEN)).toBe(120n);
  });
});

describe("staticContractSet", () => {
  it("exposes one lowercased contract with a null startBlock", async () => {
    const set = staticContractSet(() => TOKEN.toUpperCase());

    expect(await set.refreshRegistry()).toEqual([
      { address: TOKEN, startBlock: null },
    ]);
    expect(set.getKnownContract(TOKEN.toUpperCase())).toEqual({
      address: TOKEN,
      startBlock: null,
    });
    expect(set.getKnownContract(OTHER_TOKEN)).toBeUndefined();
  });

  it("is empty while the address is unconfigured", async () => {
    const set = staticContractSet(() => null);

    expect(await set.refreshRegistry()).toEqual([]);
    expect(set.getKnownContract(TOKEN)).toBeUndefined();
  });
});

describe("watch", () => {
  it("subscribes before the first sweep and backfills existing logs", async () => {
    const h = buildHarness({ logs: [transferLog(110n, 0)] });

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      const subscribeAt = h.calls.indexOf("watchEvent");
      const sweepAt = h.calls.findIndex((c) => c.startsWith("getLogs:"));
      expect(subscribeAt).toBeGreaterThanOrEqual(0);
      expect(subscribeAt).toBeLessThan(sweepAt);
      expect(h.handled).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("sweeps on every discovery tick so logs the subscription missed are recovered", async () => {
    const h = buildHarness();

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      // A log the live subscription never delivered (e.g. mined during the
      // eth_subscribe handshake) is picked up by the next tick's sweep.
      h.addChainLog(transferLog(130n, 0));
      h.setChainHead(140n);

      await waitFor(() => h.cursor() === 140n);
      expect(h.handled).toHaveLength(1);
      // The address set never changed, so no resubscription happened.
      expect(h.calls.filter((c) => c === "watchEvent")).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("retries a failed sweep on the next discovery tick", async () => {
    const h = buildHarness();
    h.failNextBackfill(new Error("rpc hiccup"));

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      // The failed sweep left the watermark unset; a later tick completed it.
      expect(
        h.calls.filter((c) => c.startsWith("getLogs:")).length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      stop();
    }
  });

  it("persists live logs without advancing the watermark", async () => {
    const h = buildHarness();

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      await h.emitLive([transferLog(130n, 0)]);

      expect(h.handled).toHaveLength(1);
      // Only sweeps move the cursor: a missed sibling of this log can still
      // be recovered because the watermark stayed below it.
      expect(h.cursor()).toBe(120n);
    } finally {
      stop();
    }
  });

  it("recovers a live log whose persistence failed via the next sweep", async () => {
    const h = buildHarness();

    const stop = h.watcher.watch(h.client);
    try {
      await waitFor(() => h.cursor() === 120n);

      // The live path swallows the error (viem does not await onLogs) and
      // the watermark stays put...
      h.failHandleLogAt(0);
      await h.emitLive([transferLog(130n, 0)]);
      expect(h.handled).toHaveLength(0);
      expect(h.cursor()).toBe(120n);

      // ...so the next tick's sweep replays it from the chain.
      h.addChainLog(transferLog(130n, 0));
      h.setChainHead(140n);
      await waitFor(() => h.handled.length === 1);
      await waitFor(() => h.cursor() === 140n);
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
