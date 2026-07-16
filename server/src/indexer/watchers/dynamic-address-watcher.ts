import type { AbiEvent, Log } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import {
  getLastProcessedBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";

/**
 * Shared scaffolding for watchers over a dynamic address set: contracts are
 * discovered from database rows as markets graduate, each runs behind its own
 * per-address cursor, and the live subscription is rebuilt on a discovery
 * interval when new contracts appear. A contract discovered late backfills
 * from its own start block, so nothing is lost to late discovery.
 *
 * The loss-proofing invariant, deliberately centralized here so no
 * per-watcher copy can drift: **the cursor is a sweep watermark — only
 * recovery sweeps advance it, never live delivery.** Recovery restarts at
 * cursor + 1, and a sweep advances the cursor only over ranges whose logs it
 * fetched and persisted, in order:
 *
 * - Within a sweep, per-log progress trails the log's own block by one. One
 *   block can hold several logs, so advancing to the log's block would skip
 *   that block's later logs if processing dies between them. Trailing means
 *   a crash replays the whole block; handlers dedupe on (chain, tx, log),
 *   making replays no-ops.
 * - Only a completed sweep may jump the cursor to its block-height snapshot,
 *   guaranteeing every fetched log was persisted first. A log the sweep had
 *   to skip (unknown address) parks the sweep below that block instead, so
 *   it is retried — loudly — every tick rather than checkpointed past.
 * - The live subscription is a low-latency accelerator only. It persists
 *   rows as they arrive (double delivery is absorbed by the dedupe) but
 *   never moves the watermark, so anything it misses — the async
 *   eth_subscribe handshake window after watchEvent returns, a dropped
 *   socket, overlapping onLogs batches (viem does not await onLogs) — sits
 *   above the watermark and is re-fetched by the next sweep. Discovery ticks
 *   sweep every cycle, not just when the address set changes, bounding that
 *   catch-up to one interval; a subscription error clears the watched key so
 *   the next tick rebuilds the subscription.
 *
 * Concurrent sweeps (the local-dev recovery poll can overlap a discovery
 * tick; production runs recover() only at startup, before watch()) are safe
 * but not coordinated: cursor writes are last-writer-wins, so an older sweep
 * can briefly regress the watermark, costing a redundant re-scan — never a
 * skip, because every write implies its writer persisted everything below it.
 */

const DISCOVERY_INTERVAL_MS = 15_000;

/** One discovered contract the watcher follows. */
export type WatchedContract = {
  /** Lowercased contract address. */
  address: string;
  /**
   * Earliest block this contract can emit watched events — the safe backfill
   * start when no cursor exists yet.
   */
  startBlock: bigint;
};

/** Options for a recovery sweep; quiet suppresses per-address idle logging. */
export type RecoveryOptions = {
  quiet?: boolean;
};

/** viem decodes logs against the event set, attaching the matched name. */
export type DynamicWatcherLog = Log & { eventName?: string };

type CursorTracker = {
  getLastProcessedBlock: typeof getLastProcessedBlock;
  updateLastProcessedBlock: typeof updateLastProcessedBlock;
};

type DynamicAddressWatcherConfig<TContract extends WatchedContract> = {
  /** Console-log prefix, e.g. "OutcomeTokenTransfer". */
  label: string;
  /** Per-address cursor name in indexer_cursors. Never rename: live rows. */
  cursorName: string;
  /**
   * Noun for log lines, pluralized with a bare "s" — e.g. "graduated outcome
   * token".
   */
  subject: string;
  /**
   * Events to subscribe to and backfill, shared across the address set. The
   * subscription topic-filters on exactly these signatures (via watchEvent's
   * OR filter), so handlers only ever see this set.
   */
  events: AbiEvent[];
  /** Re-reads the discovered contract set from the database. */
  refreshRegistry: () => Promise<TContract[]>;
  /**
   * Looks up one discovered contract from the registry's in-process cache by
   * address (case-insensitive).
   */
  getKnownContract: (address: string) => TContract | undefined;
  /**
   * Persists one decoded log. Must be replay-idempotent — the watermark
   * discipline above guarantees redelivery, not exactly-once. Must NOT touch
   * the cursor; the scaffolding owns it. Throwing aborts the current sweep
   * (retried on the next discovery tick) without advancing past the log.
   */
  handleLog: (
    client: BlockchainClient,
    log: DynamicWatcherLog,
    contract: TContract,
  ) => Promise<void>;
  /** Injection seam for tests; production uses the db-backed block tracker. */
  tracker?: CursorTracker;
  /** Discovery cadence override for tests. */
  discoveryIntervalMs?: number;
};

/**
 * Builds a watcher over a dynamic contract set: `recover` runs one catch-up
 * sweep to the given block, `watch` runs the discovery loop (sweep + live
 * subscription) until its returned stop function is called. Both deliver
 * every log at least once (see the module comment for the guarantees);
 * handleLog supplies the per-event persistence.
 */
export function createDynamicAddressWatcher<TContract extends WatchedContract>(
  config: DynamicAddressWatcherConfig<TContract>,
) {
  const { cursorName, events, label, subject } = config;
  const tracker = config.tracker ?? {
    getLastProcessedBlock,
    updateLastProcessedBlock,
  };
  const discoveryIntervalMs =
    config.discoveryIntervalMs ?? DISCOVERY_INTERVAL_MS;

  /** Persists one log; false means it was skipped and must stay unswept. */
  async function processLog(
    client: BlockchainClient,
    log: DynamicWatcherLog,
  ): Promise<boolean> {
    const address = log.address.toLowerCase();
    let contract = config.getKnownContract(address);

    if (!contract) {
      await config.refreshRegistry();
      contract = config.getKnownContract(address);
    }

    // Only registry-discovered addresses are watched, so a miss is a stale
    // in-process cache at worst; the caller keeps the watermark below this
    // log so the next sweep retries it.
    if (!contract) {
      console.warn(
        `[${label}] Event for unknown ${subject} ${address}; skipping`,
      );
      return false;
    }

    await config.handleLog(client, log, contract);
    return true;
  }

  /**
   * One catch-up pass for every contract, from its watermark (or start
   * block) to the currentBlock snapshot. Contracts sharing a fromBlock are
   * fetched with a single getLogs — with every-tick sweeps, per-address
   * queries would cost one RPC per address per tick, while in steady state
   * all watermarks sit at the previous tick's snapshot and coalesce into one
   * call.
   */
  async function sweep(
    client: BlockchainClient,
    currentBlock: bigint,
    contracts: TContract[],
    options: RecoveryOptions,
  ) {
    const groups = new Map<bigint, TContract[]>();
    for (const contract of contracts) {
      const lastProcessed = await tracker.getLastProcessedBlock(
        contract.address,
        cursorName,
      );
      // First recovery starts at the contract's own start block, not the
      // global deploy-block heuristics: no watched event can be earlier, and
      // a contract discovered at the chain head must still scan its start
      // block (hence > rather than the singleton watchers' >=).
      const fromBlock =
        lastProcessed !== null ? lastProcessed + 1n : contract.startBlock;

      if (fromBlock > currentBlock) {
        if (!options.quiet) {
          console.log(`[${label}] ${contract.address}: no blocks to recover`);
        }
        continue;
      }

      groups.set(fromBlock, [...(groups.get(fromBlock) ?? []), contract]);
    }

    for (const [fromBlock, group] of groups) {
      await sweepGroup(client, currentBlock, fromBlock, group, options);
    }
  }

  async function sweepGroup(
    client: BlockchainClient,
    currentBlock: bigint,
    fromBlock: bigint,
    group: TContract[],
    options: RecoveryOptions,
  ) {
    const addresses = group.map(
      (contract) => contract.address as `0x${string}`,
    );
    const logs = await client.getLogs({
      address: addresses,
      events,
      fromBlock,
      toBlock: currentBlock,
    });

    if (!options.quiet) {
      console.log(
        `[${label}] ${addresses.join(",")}: found ${logs.length} historical events`,
      );
    }

    for (const log of logs) {
      const persisted = await processLog(client, log as DynamicWatcherLog);
      // A skipped log parks the whole group below its block: no snapshot
      // jump, so the next sweep re-fetches and retries it (see the module
      // comment). Prior per-log advances stand — everything before this log
      // was persisted.
      if (!persisted) {
        return;
      }
      // Trail the log's block by one: a crash here replays the whole block
      // on the next sweep instead of skipping its remaining logs.
      if (log.blockNumber !== null) {
        await tracker.updateLastProcessedBlock(
          log.address.toLowerCase(),
          cursorName,
          log.blockNumber - 1n,
        );
      }
    }

    // Only a completed pass may jump the watermarks to the sweep's snapshot,
    // guaranteeing every fetched log was persisted first.
    for (const contract of group) {
      await tracker.updateLastProcessedBlock(
        contract.address,
        cursorName,
        currentBlock,
      );
    }
  }

  async function recover(
    client: BlockchainClient,
    currentBlock: bigint,
    options: RecoveryOptions = {},
  ) {
    const contracts = await config.refreshRegistry();

    if (contracts.length === 0) {
      if (!options.quiet) {
        console.log(`[${label}] No ${subject}s known; skipping`);
      }
      return;
    }

    await sweep(client, currentBlock, contracts, options);
  }

  function watch(client: BlockchainClient) {
    console.log(`[${label}] Starting real-time event watcher`);

    let stopped = false;
    let synchronizing = false;
    let unwatch: () => void = () => {};
    let watchedAddressKey: string | null = null;

    // Every tick: rebuild the subscription if the discovered set changed (or
    // the previous subscription errored), then sweep from each watermark.
    // The unconditional sweep is what closes the windows the subscription
    // alone cannot (see the module comment).
    const synchronize = async () => {
      if (stopped || synchronizing) {
        return;
      }
      synchronizing = true;

      try {
        const contracts = await config.refreshRegistry();
        const addressKey = contracts
          .map((contract) => contract.address)
          .sort()
          .join(",");

        if (stopped) {
          return;
        }

        if (addressKey !== watchedAddressKey) {
          // Subscribing before the sweep is best-effort latency, not
          // correctness: watchEvent returns before eth_subscribe completes,
          // so only the sweep watermark guarantees delivery.
          unwatch();
          unwatch =
            contracts.length === 0
              ? () => {}
              : client.watchEvent({
                  address: contracts.map(
                    (contract) => contract.address as `0x${string}`,
                  ),
                  events,
                  onError: (error) => {
                    console.error(`[${label}] Watch error:`, error);
                    // viem does not retry a failed eth_subscribe handshake;
                    // clearing the key makes the next tick rebuild the
                    // subscription instead of leaving live delivery dead.
                    watchedAddressKey = null;
                  },
                  onLogs: async (logs) => {
                    for (const log of logs) {
                      try {
                        await processLog(client, log as DynamicWatcherLog);
                      } catch (error) {
                        // Live delivery never advances the watermark, so a
                        // failed log is replayed by the next sweep; log and
                        // keep the process alive rather than surface an
                        // unhandled rejection (viem does not await onLogs).
                        console.error(`[${label}] Live log error:`, error);
                      }
                    }
                  },
                });
          watchedAddressKey = addressKey;

          if (contracts.length > 0) {
            console.log(
              `[${label}] Watching ${contracts.length} ${subject}(s)`,
            );
          }
        }

        const currentBlock = await client.getBlockNumber();
        await sweep(client, currentBlock, contracts, { quiet: true });
      } finally {
        synchronizing = false;
      }
    };

    const logSynchronizeError = (error: unknown) => {
      console.error(`[${label}] Contract discovery error:`, error);
    };

    void synchronize().catch(logSynchronizeError);
    const discoveryInterval = setInterval(() => {
      void synchronize().catch(logSynchronizeError);
    }, discoveryIntervalMs);

    return () => {
      stopped = true;
      clearInterval(discoveryInterval);
      unwatch();
    };
  }

  return { recover, watch };
}
