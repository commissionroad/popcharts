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
 * cursor + 1, so a log above the watermark can only be skipped if a sweep
 * advanced past it, and a sweep advances only over ranges it fetched and
 * persisted:
 *
 * - Within a sweep, per-log progress trails the log's own block by one. One
 *   block can hold several logs, so advancing to the log's block would skip
 *   that block's later logs if processing dies between them. Trailing means
 *   a crash replays the whole block; handlers dedupe on (chain, tx, log),
 *   making replays no-ops.
 * - Only a completed sweep may jump the cursor to its block-height snapshot,
 *   guaranteeing every fetched log was persisted first.
 * - The live subscription is a low-latency accelerator only. It persists rows
 *   as they arrive (double delivery is absorbed by the dedupe) but never
 *   moves the watermark, so anything it misses — the async eth_subscribe
 *   handshake window after watchEvent returns, a dropped socket, overlapping
 *   onLogs batches (viem does not await onLogs) — sits above the watermark
 *   and is re-fetched by the next sweep. Discovery ticks sweep every cycle,
 *   not just when the address set changes, bounding that catch-up to one
 *   interval.
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

  async function processLog(client: BlockchainClient, log: DynamicWatcherLog) {
    const address = log.address.toLowerCase();
    let contract = config.getKnownContract(address);

    if (!contract) {
      await config.refreshRegistry();
      contract = config.getKnownContract(address);
    }

    // Only registry-discovered addresses are watched, so a miss is a stale
    // in-process cache at worst; the log stays above the watermark and the
    // next sweep replays it.
    if (!contract) {
      console.warn(
        `[${label}] Event for unknown ${subject} ${address}; skipping`,
      );
      return;
    }

    await config.handleLog(client, log, contract);
  }

  async function recoverContract(
    client: BlockchainClient,
    currentBlock: bigint,
    contract: TContract,
    options: RecoveryOptions,
  ) {
    const lastProcessed = await tracker.getLastProcessedBlock(
      contract.address,
      cursorName,
    );
    // First recovery starts at the contract's own start block, not the global
    // deploy-block heuristics: no watched event can be earlier, and a
    // contract discovered at the chain head must still scan its start block
    // (hence > rather than the singleton watchers' >=).
    const fromBlock =
      lastProcessed !== null ? lastProcessed + 1n : contract.startBlock;

    if (fromBlock > currentBlock) {
      if (!options.quiet) {
        console.log(`[${label}] ${contract.address}: no blocks to recover`);
      }
      return;
    }

    const logs = await client.getLogs({
      address: contract.address as `0x${string}`,
      events,
      fromBlock,
      toBlock: currentBlock,
    });

    if (logs.length === 0) {
      if (!options.quiet) {
        console.log(
          `[${label}] ${contract.address}: found 0 historical events`,
        );
      }
      await tracker.updateLastProcessedBlock(
        contract.address,
        cursorName,
        currentBlock,
      );
      return;
    }

    if (!options.quiet) {
      console.log(
        `[${label}] ${contract.address}: found ${logs.length} historical events`,
      );
    }

    for (const log of logs) {
      await processLog(client, log as DynamicWatcherLog);
      // Trail the log's block by one (see the module comment): a crash here
      // replays the whole block on the next sweep instead of skipping its
      // remaining logs.
      if (log.blockNumber !== null) {
        await tracker.updateLastProcessedBlock(
          contract.address,
          cursorName,
          log.blockNumber - 1n,
        );
      }
    }

    // Only a completed pass may jump the watermark to the sweep's snapshot,
    // guaranteeing every fetched log was persisted first.
    await tracker.updateLastProcessedBlock(
      contract.address,
      cursorName,
      currentBlock,
    );
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

    for (const contract of contracts) {
      await recoverContract(client, currentBlock, contract, options);
    }
  }

  function watch(client: BlockchainClient) {
    console.log(`[${label}] Starting real-time event watcher`);

    let stopped = false;
    let synchronizing = false;
    let unwatch: () => void = () => {};
    let watchedAddressKey: string | null = null;

    // Every tick: rebuild the subscription if the discovered set changed,
    // then sweep from each watermark. The unconditional sweep is what closes
    // the windows the subscription alone cannot (see the module comment).
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
        for (const contract of contracts) {
          await recoverContract(client, currentBlock, contract, {
            quiet: true,
          });
        }
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
