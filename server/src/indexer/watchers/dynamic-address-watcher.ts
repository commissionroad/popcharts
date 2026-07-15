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
 * The cursor discipline is what keeps money events loss-proof, and it is
 * deliberately centralized here so no per-watcher copy can drift:
 *
 * - Per-log processing advances the cursor only to blockNumber - 1. One block
 *   can hold several logs, so advancing to the log's own block would skip
 *   that block's later logs if processing dies between them (recovery
 *   restarts at cursor + 1). Trailing by one block means a crash replays the
 *   whole block instead; handlers dedupe on (chain, tx, log), making replays
 *   no-ops.
 * - Only a completed recovery sweep may jump the cursor to its block
 *   snapshot, guaranteeing every fetched log was persisted first.
 * - synchronize() subscribes BEFORE backfilling. A log mined between a
 *   backfill's block snapshot and the subscription install would be seen by
 *   neither path, and once a later live log advanced the cursor past it the
 *   row would be lost for good. Subscribing first can only double-deliver,
 *   which the dedupe absorbs.
 * - The watched address key is marked only after a full backfill: if recovery
 *   threw, the live subscription stays up but the next discovery tick retries
 *   the sweep.
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
  /** Events to subscribe to and backfill, shared across the address set. */
  events: AbiEvent[];
  /** Re-reads the discovered contract set from the database. */
  refreshRegistry: () => Promise<TContract[]>;
  /**
   * Looks up one discovered contract from the registry's in-process cache by
   * address (case-insensitive).
   */
  getKnownContract: (address: string) => TContract | undefined;
  /**
   * Persists one decoded log. Must be replay-idempotent — the cursor
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
    // in-process cache at worst; leaving the cursor behind replays the log.
    if (!contract) {
      console.warn(
        `[${label}] Event for unknown ${subject} ${address}; skipping`,
      );
      return;
    }

    await config.handleLog(client, log, contract);

    if (log.blockNumber !== null) {
      await tracker.updateLastProcessedBlock(
        address,
        cursorName,
        log.blockNumber - 1n,
      );
    }
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

    console.log(
      `[${label}] ${contract.address}: found ${logs.length} historical events`,
    );

    for (const log of logs) {
      await processLog(client, log as DynamicWatcherLog);
    }

    // Per-log processing deliberately leaves the cursor one block behind (see
    // the module comment); only a completed sweep may jump it to the
    // snapshot, guaranteeing every fetched log was persisted first.
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

    // Rebuilds the subscription whenever the discovered contract set changes.
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

        if (addressKey === watchedAddressKey || stopped) {
          return;
        }

        // Subscribe BEFORE backfilling — see the module comment for why the
        // reverse order can permanently lose a log.
        unwatch();
        unwatch =
          contracts.length === 0
            ? () => {}
            : client.watchContractEvent({
                abi: events,
                address: contracts.map(
                  (contract) => contract.address as `0x${string}`,
                ),
                onError: (error) => {
                  console.error(`[${label}] Watch error:`, error);
                },
                onLogs: async (logs) => {
                  for (const log of logs) {
                    await processLog(client, log as DynamicWatcherLog);
                  }
                },
              });

        const currentBlock = await client.getBlockNumber();
        for (const contract of contracts) {
          await recoverContract(client, currentBlock, contract, {
            quiet: true,
          });
        }

        // Marked only after a full backfill: if recovery threw, the live
        // subscription stays up but the next discovery tick retries the sweep.
        watchedAddressKey = addressKey;

        if (contracts.length > 0) {
          console.log(`[${label}] Watching ${contracts.length} ${subject}(s)`);
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
