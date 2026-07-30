import type { AbiEvent, Log } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import {
  getLastProcessedBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { ParkSweepError } from "src/indexer/utils/park-sweep-error";

/**
 * Shared scaffolding for every indexer watcher. The address set is either
 * dynamic — contracts discovered from database rows as markets graduate —
 * or a single fixed contract adapted through staticContractSet; both run
 * behind per-address cursors, and the live subscription is rebuilt on a
 * discovery interval when the set changes. A contract discovered late
 * backfills from its own start block, so nothing is lost to late discovery.
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
 *   guaranteeing every fetched log was persisted first. A log the sweep could
 *   not apply parks that log's **address** below that block instead, so it is
 *   retried — loudly — every tick rather than checkpointed past. Two cases
 *   park: a log from an unknown address, and a handler raising a
 *   ParkSweepError ("not yet", as opposed to "broken"). Parking one address
 *   leaves its groupmates free to finish the chunk and checkpoint, and holds
 *   the parked address back from its own later logs — contracts share a
 *   watermark, not a fate. Parking per *group* would look equivalent and is
 *   not: in steady state every contract sits on the same watermark and so in
 *   the same group, and the group is swept in chain order, so one unappliable
 *   log would starve every market whose logs sort after it, forever. Any
 *   other handler error still propagates and abandons the pass, which is the
 *   right default for a failure nobody anticipated.
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
// Max block span per eth_getLogs during a sweep, below common provider caps.
const SWEEP_CHUNK_BLOCKS = 10_000n;

function bigintMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}

function bigintMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}

/** One discovered contract the watcher follows. */
export type WatchedContract = {
  /** Lowercased contract address. */
  address: string;
  /**
   * Earliest block this contract can emit watched events — the safe backfill
   * start when no cursor exists yet. Null for fixed contracts with no
   * discovery event; the watcher's fallbackStartBlock resolves it instead.
   */
  startBlock: bigint | null;
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
  /**
   * Resolves the first-recovery start for contracts with a null startBlock
   * (fixed contracts, which have no discovery event to anchor on). Fixed
   * watchers pass the deploy-block heuristics; required whenever the registry
   * can return a null startBlock.
   */
  fallbackStartBlock?: (currentBlock: bigint) => bigint;
  /** Injection seam for tests; production uses the db-backed block tracker. */
  tracker?: CursorTracker;
  /** Discovery cadence override for tests. */
  discoveryIntervalMs?: number;
};

/**
 * Registry adapter for a watcher over one fixed, config-supplied contract:
 * the "discovered set" is that single address (or empty while unconfigured,
 * e.g. an unset order manager on a fresh devchain), and the start block is
 * left to the watcher's fallbackStartBlock.
 */
export function staticContractSet(getAddress: () => string | null) {
  const contract = (): WatchedContract | null => {
    const address = getAddress();
    return address
      ? { address: address.toLowerCase(), startBlock: null }
      : null;
  };

  return {
    getKnownContract: (address: string) => {
      const known = contract();
      return known && known.address === address.toLowerCase()
        ? known
        : undefined;
    },
    refreshRegistry: async () => {
      const known = contract();
      return known ? [known] : [];
    },
  };
}

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

    try {
      await config.handleLog(client, log, contract);
    } catch (error) {
      // A handler that says "not yet" gets the same treatment as an unknown
      // address: park this group below the log so the next sweep retries it,
      // and let the rest of the pass carry on. Letting it propagate instead
      // would abandon every group the pass had not reached — and since the
      // fault reproduces every tick, starve them for good.
      if (!(error instanceof ParkSweepError)) {
        throw error;
      }

      console.warn(
        `[${label}] ${error.name} for ${address}; parking the sweep below block ${log.blockNumber}: ${error.message}`,
      );
      return false;
    }

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
      // First recovery starts at the contract's own start block where one is
      // known (no watched event can be earlier, and a contract discovered at
      // the chain head must still scan its start block — hence > rather than
      // >=); fixed contracts have none and fall back to the deploy-block
      // heuristics.
      const startBlock =
        contract.startBlock ?? config.fallbackStartBlock?.(currentBlock);
      if (startBlock === undefined) {
        throw new Error(
          `[${label}] ${contract.address} has no startBlock and no fallbackStartBlock is configured.`,
        );
      }
      const fromBlock =
        lastProcessed !== null ? lastProcessed + 1n : startBlock;

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

    // Bounded ranges: RPC providers cap eth_getLogs spans and result sizes,
    // and a first recovery (fresh deployment, consolidated cursor) may span
    // deploy-to-head. Each completed chunk advances the watermarks, so a
    // crash or cap-induced failure resumes at the last chunk boundary
    // instead of retrying one oversized request forever. The span adapts:
    // a getLogs failure halves it (result-size caps on dense ranges — e.g.
    // per-swap events — would otherwise refetch the same too-big range every
    // tick, parking the sweep permanently), and each success doubles it back
    // toward the maximum. Only a failure at the single-block floor
    // propagates, since that can't be a range-size problem.
    // Addresses whose cursor is stuck below a log this sweep could not apply.
    // Scoped to the sweep rather than the chunk: once an address parks, every
    // later log of its own must wait too, in this chunk and every chunk after
    // it. Applying a block-200 event while its block-110 event is unapplied is
    // precisely the out-of-order projection parking exists to prevent.
    const parked = new Set<string>();

    let span = SWEEP_CHUNK_BLOCKS;
    let chunkFrom = fromBlock;
    while (chunkFrom <= currentBlock && parked.size < group.length) {
      const chunkTo = bigintMin(chunkFrom + span - 1n, currentBlock);
      let logs;
      try {
        logs = await client.getLogs({
          address: addresses,
          events,
          fromBlock: chunkFrom,
          toBlock: chunkTo,
        });
      } catch (error) {
        if (span === 1n) {
          throw error;
        }
        span = bigintMax(span / 2n, 1n);
        console.warn(
          `[${label}] getLogs failed for ${chunkFrom}-${chunkTo}; retrying with span ${span}:`,
          error,
        );
        continue;
      }

      if (!options.quiet && logs.length > 0) {
        console.log(
          `[${label}] ${addresses.join(",")}: found ${logs.length} historical events`,
        );
      }

      // Watermark advances assume chain order; eth_getLogs responses are
      // ordered in practice but not guaranteed, and handlers that wait on an
      // earlier event (e.g. a fill on its OrderCreated) would park the sweep
      // forever if its prerequisite sat later in the same response.
      const ordered = [...logs].sort((a, b) =>
        a.blockNumber !== b.blockNumber
          ? Number(a.blockNumber! - b.blockNumber!)
          : a.logIndex! - b.logIndex!,
      );

      for (const log of ordered) {
        const address = log.address.toLowerCase();
        if (parked.has(address)) {
          continue;
        }

        const persisted = await processLog(client, log as DynamicWatcherLog);
        // A log the sweep could not apply parks its own address below that
        // block: no per-log advance and no snapshot jump for that address, so
        // the next sweep re-fetches and retries it (see the module comment).
        // Every other address in the group carries on — they share only a
        // watermark, not a fate, and in steady state the whole watcher shares
        // one watermark, so parking the group would starve every market
        // behind the offending one.
        if (!persisted) {
          parked.add(address);
          continue;
        }
        // Trail the log's block by one: a crash here replays the whole block
        // on the next sweep instead of skipping its remaining logs.
        if (log.blockNumber !== null) {
          await tracker.updateLastProcessedBlock(
            address,
            cursorName,
            log.blockNumber - 1n,
          );
        }
      }

      // Only a completed chunk may jump the watermarks to its end block,
      // guaranteeing every fetched log was persisted first — which is true of
      // every address that did not park, and false of every one that did.
      for (const contract of group) {
        if (parked.has(contract.address.toLowerCase())) {
          continue;
        }
        await tracker.updateLastProcessedBlock(
          contract.address,
          cursorName,
          chunkTo,
        );
      }

      chunkFrom = chunkTo + 1n;
      span = bigintMin(span * 2n, SWEEP_CHUNK_BLOCKS);
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
