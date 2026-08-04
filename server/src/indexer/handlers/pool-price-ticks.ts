import type { PriceTickWire } from "@popcharts/live-channels";
import type { Log } from "viem";

import { createReadOnlyClient } from "src/blockchain/client";
import { recordLiveChange } from "src/change-feed/writer";
import type { NetworkConfig } from "src/config";
import { and, db, desc, eq, lt, ne, or, schema } from "src/db/client";
import { logValueRequirer } from "src/indexer/utils/log-values";
import {
  createCollateralDecimalsReader,
  venueOpeningCents,
  venueTickToCents,
} from "src/shared/venue-prices";

const requireValue = logValueRequirer("Pool price tick log");

export type PoolPriceTickLog = Log & {
  args: {
    poolId?: `0x${string}`;
    tick?: number;
    sequence?: bigint;
  };
};

export type PoolPriceTickRecord = typeof schema.poolPriceTicks.$inferInsert;

/** Chain reads the priced-tick emit needs, injectable in tests. */
export type PoolPriceTickDependencies = {
  readCollateralDecimals: (collateral: `0x${string}`) => Promise<number>;
};

type BuildInput = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: PoolPriceTickLog;
};

/**
 * Maps an AfterSwapTickObserved log from the BoundedPredictionHook into a
 * typed pool_price_ticks row. The raw tick and the hook's per-pool swap
 * sequence are recorded; cent prices are derived at the emit seam below and
 * on API reads, never stored.
 */
export function buildPoolPriceTickRecord(
  input: BuildInput,
): PoolPriceTickRecord {
  const { blockTimestamp, config, contractId, log } = input;

  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    logIndex: requireValue(log.logIndex, "logIndex"),
    poolId: requireValue(log.args.poolId, "poolId").toLowerCase(),
    sequence: requireValue(log.args.sequence, "sequence"),
    tick: requireValue(log.args.tick, "tick"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

/**
 * Persists the raw tick observation. Append-only: there is no projection to
 * update. The insert dedupes on (chain, tx, log) so a recovery replay or
 * double live delivery never double-records a swap tick.
 *
 * A fresh tick signals the market's live channel (repo ADR 0021) — atomic
 * with the insert — and, per repo ADR 0025, the signal carries a priced
 * tick payload so the chart appends one point instead of refetching the
 * whole history: this pool's new price plus the sibling pool's standing
 * price (its own last tick, or the venue opening price before any),
 * stamped with the pool-id stream and the hook's per-pool sequence.
 *
 * The market route is the only one a tick has, so when the pool maps to no
 * indexed market (best-effort mapping, see ensureVenuePoolIndexed) nothing
 * is recorded rather than an unroutable row. When the *payload* cannot be
 * assembled — sibling pool not yet indexed, market row missing, decimals
 * read failing — the signal degrades to a payload-less nudge (the client
 * refetches, exactly the pre-ADR-0025 behaviour) rather than blocking tick
 * indexing.
 */
export async function persistPoolPriceTickRecord(
  record: PoolPriceTickRecord,
  dbc: typeof db = db,
  dependencies: PoolPriceTickDependencies = defaultDependencies(),
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.poolPriceTicks)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.poolPriceTicks.id });

    if (!inserted[0]) {
      return;
    }

    const pool = await tx.query.venuePools.findFirst({
      where: and(
        eq(schema.venuePools.chainId, record.chainId),
        eq(schema.venuePools.poolId, record.poolId),
      ),
    });

    if (!pool) {
      return;
    }

    let tick: PriceTickWire | null = null;
    try {
      tick = await buildVenuePriceTick({ dependencies, pool, record, tx });
    } catch (error) {
      console.warn(
        `[PoolPriceTick] Priced-tick payload failed for pool ${record.poolId}; ` +
          "signalling a plain nudge:",
        error,
      );
    }

    await recordLiveChange(tx, {
      sourceTable: "pool_price_ticks",
      op: "insert",
      chainId: record.chainId,
      marketId: pool.marketId,
      rowId: inserted[0].id,
      blockNumber: record.blockNumber,
      logIndex: record.logIndex,
      ...(tick ? { tick } : {}),
    });
  });
}

type VenuePoolRow = typeof schema.venuePools.$inferSelect;

/**
 * Assembles the priced tick for a fresh swap: the moved pool's price from its
 * new tick, the sibling's from its latest recorded tick (or the venue opening
 * price when it has never traded — the forward-fill ADR 0025 specifies).
 * Returns null when the venue is not fully indexed yet, which the caller
 * treats as "signal without payload".
 *
 * Runs inside the insert transaction; the only chain read is the memoised
 * per-collateral decimals lookup, paid once per process per collateral.
 */
async function buildVenuePriceTick({
  dependencies,
  pool,
  record,
  tx,
}: {
  dependencies: PoolPriceTickDependencies;
  pool: VenuePoolRow;
  record: PoolPriceTickRecord;
  tx: Pick<typeof db, "query">;
}): Promise<PriceTickWire | null> {
  const [sibling, market] = await Promise.all([
    tx.query.venuePools.findFirst({
      where: and(
        eq(schema.venuePools.chainId, record.chainId),
        eq(schema.venuePools.marketId, pool.marketId),
        ne(schema.venuePools.poolId, pool.poolId),
      ),
    }),
    tx.query.markets.findFirst({
      where: and(
        eq(schema.markets.chainId, record.chainId),
        eq(schema.markets.marketId, pool.marketId),
      ),
    }),
  ]);

  if (!sibling || !market) {
    return null;
  }

  const collateralDecimals = await dependencies.readCollateralDecimals(
    market.collateral as `0x${string}`,
  );
  const movedCents = venueTickToCents({
    collateralDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    tick: record.tick,
  });

  // Bounded to chain coordinates strictly before this event, not "latest
  // committed": the watcher explicitly allows a sweep and live delivery to
  // overlap, so a later sibling swap can be in the table before an earlier
  // event of this pool is processed — an unbounded lookup would stamp the
  // earlier payload with a future price (Codex P2 review finding).
  const siblingLastTick = await tx.query.poolPriceTicks.findFirst({
    where: and(
      eq(schema.poolPriceTicks.chainId, record.chainId),
      eq(schema.poolPriceTicks.poolId, sibling.poolId),
      or(
        lt(schema.poolPriceTicks.blockNumber, record.blockNumber),
        and(
          eq(schema.poolPriceTicks.blockNumber, record.blockNumber),
          lt(schema.poolPriceTicks.logIndex, record.logIndex),
        ),
      ),
    ),
    orderBy: [
      desc(schema.poolPriceTicks.blockNumber),
      desc(schema.poolPriceTicks.logIndex),
    ],
  });
  const siblingCents = siblingLastTick
    ? venueTickToCents({
        collateralDecimals,
        outcomeIsCurrency0: sibling.outcomeIsCurrency0,
        tick: siblingLastTick.tick,
      })
    : venueOpeningCents(market, sibling.side);

  return {
    t: record.blockTimestamp.toISOString(),
    stream: pool.poolId,
    sequence: Number(record.sequence),
    yesPriceCents: pool.side === "yes" ? movedCents : siblingCents,
    noPriceCents: pool.side === "no" ? movedCents : siblingCents,
  };
}

/**
 * Lazily built so importing this module never opens an RPC connection —
 * tests inject their own reader, and the indexer builds one on first use.
 */
let cachedDependencies: PoolPriceTickDependencies | null = null;

function defaultDependencies(): PoolPriceTickDependencies {
  cachedDependencies ??= {
    readCollateralDecimals:
      createCollateralDecimalsReader(createReadOnlyClient),
  };

  return cachedDependencies;
}
