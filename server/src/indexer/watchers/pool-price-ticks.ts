import { boundedPredictionHookAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config, ZERO_ADDRESS } from "src/config";
import {
  buildPoolPriceTickRecord,
  persistPoolPriceTickRecord,
  type PoolPriceTickLog,
} from "src/indexer/handlers/pool-price-ticks";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import { ensurePoolMappingIndexed } from "src/indexer/utils/venue-pool-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches AfterSwapTickObserved on the BoundedPredictionHook so every taker
 * swap on a bounded pool leaves a pool_price_ticks row — the price-history
 * source for graduated markets. Taker swaps are otherwise invisible to the
 * database: they route through the pool manager and emit no order-manager
 * events. BeforeSwapTickObserved is deliberately not indexed — the post-swap
 * tick is the price the swap established.
 */

const CURSOR_NAME = "PoolPriceTick";

const AFTER_SWAP_TICK_OBSERVED_EVENT = getAbiItem({
  abi: boundedPredictionHookAbi,
  name: "AfterSwapTickObserved",
});

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [AFTER_SWAP_TICK_OBSERVED_EVENT],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const tickLog = log as PoolPriceTickLog;
    // Deliberately no per-log console output: this fires once per swap, and
    // sweeps replay live-delivered ticks by design — per-tick narration would
    // dominate the indexer's stdout at any real trading volume.

    const contractId = await getOrCreateContractId(
      config.contracts.boundedHook,
      "BoundedPredictionHook",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildPoolPriceTickRecord({
      blockTimestamp,
      config,
      contractId,
      log: tickLog,
    });

    // Register the pool→market mapping before persisting (mirrors the
    // venue-orders watcher): the persist routes a market-channel live signal
    // through venue_pools, and a tick committed while the pool is unmapped
    // never re-signals — the replay dedups on the event row. Best-effort by
    // design: a failure here must never block tick indexing.
    await ensurePoolMappingIndexed(client, record.poolId);

    await persistPoolPriceTickRecord(record);
  },
  label: "PoolPriceTick",
  subject: "bounded hook",
  // The hook address is unset until the venue deploys on a chain.
  ...staticContractSet(() =>
    config.contracts.boundedHook === ZERO_ADDRESS
      ? null
      : config.contracts.boundedHook,
  ),
});

/** Catch-up sweep over swap tick observations up to currentBlock. */
export const recoverPoolPriceTickEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchPoolPriceTickEvents = watcher.watch;
