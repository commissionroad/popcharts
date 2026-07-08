import { completeSetBinaryMarketAbi } from "@popcharts/protocol";

import type { BlockchainClient } from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";
import { and, db, eq, schema } from "src/db/client";
import {
  buildVenuePoolRecords,
  persistVenuePoolRecords,
  type VenuePoolRecord,
} from "src/indexer/handlers/venue-pools";

// Pool ids already known to have a venue_pools row (or to have been
// registered this process run); avoids re-querying on every order event.
const knownVenuePoolIds = new Set<string>();

/**
 * Ensures the poolId → market mapping exists before order events for the pool
 * are projected, by matching the pool against the deterministic pool ids of
 * every graduated market. Best-effort by design: pools that match no indexed
 * market (e.g. the operator demo market, which has no markets row) are logged
 * and skipped, and their order events still index by poolId alone.
 */
export async function ensureVenuePoolIndexed(
  client: BlockchainClient,
  poolId: string,
): Promise<void> {
  const normalized = poolId.toLowerCase();

  if (knownVenuePoolIds.has(normalized) || !venuePoolDerivationConfigured()) {
    return;
  }

  const existing = await db.query.venuePools.findFirst({
    where: and(
      eq(schema.venuePools.chainId, config.chainId),
      eq(schema.venuePools.poolId, normalized),
    ),
  });

  if (existing) {
    knownVenuePoolIds.add(normalized);
    return;
  }

  for (const candidate of await selectGraduatedMarketVenues()) {
    let records: VenuePoolRecord[];

    try {
      records = await buildVenuePoolRecordsFromChain({ client, ...candidate });
    } catch (error) {
      console.warn(
        `[VenuePools] Could not compute pools for market ${candidate.marketId}:`,
        error,
      );
      continue;
    }

    if (!records.some((record) => record.poolId === normalized)) {
      continue;
    }

    await persistVenuePoolRecords(records);
    rememberPoolIds(records);
    return;
  }

  console.warn(
    `[VenuePools] Pool ${normalized} matches no graduated market; indexing its orders without a market mapping.`,
  );
}

/**
 * Eagerly registers both venue pools of a market the moment its graduation
 * finalizes, so the mapping exists before the first maker order. The lazy
 * ensureVenuePoolIndexed path re-derives the same rows, so callers may treat
 * failures here as non-fatal.
 */
export async function registerVenuePoolsForGraduatedMarket({
  client,
  marketId,
  postgradMarket,
}: {
  client: BlockchainClient;
  marketId: bigint;
  postgradMarket: `0x${string}`;
}): Promise<void> {
  if (!venuePoolDerivationConfigured()) {
    return;
  }

  const market = await db.query.markets.findFirst({
    where: and(
      eq(schema.markets.chainId, config.chainId),
      eq(schema.markets.marketId, marketId),
    ),
  });

  if (!market) {
    throw new Error(
      `Market chainId=${config.chainId} marketId=${marketId} has no markets row; cannot derive venue pools.`,
    );
  }

  const records = await buildVenuePoolRecordsFromChain({
    client,
    collateral: market.collateral as `0x${string}`,
    marketId,
    postgradMarket,
  });
  await persistVenuePoolRecords(records);
  rememberPoolIds(records);
}

/**
 * Pool ids hash the bounded hook address into the pool key, so without it any
 * derived mapping would be wrong; environments without the venue skip
 * registration entirely.
 */
function venuePoolDerivationConfigured() {
  return config.contracts.boundedHook !== ZERO_ADDRESS;
}

async function selectGraduatedMarketVenues() {
  return db
    .select({
      collateral: schema.markets.collateral,
      marketId: schema.graduationFinalizedEvents.marketId,
      postgradMarket: schema.graduationFinalizedEvents.postgradMarket,
    })
    .from(schema.graduationFinalizedEvents)
    .innerJoin(
      schema.markets,
      and(
        eq(schema.markets.chainId, schema.graduationFinalizedEvents.chainId),
        eq(schema.markets.marketId, schema.graduationFinalizedEvents.marketId),
      ),
    )
    .where(eq(schema.graduationFinalizedEvents.chainId, config.chainId));
}

async function buildVenuePoolRecordsFromChain({
  client,
  collateral,
  marketId,
  postgradMarket,
}: {
  client: BlockchainClient;
  collateral: string;
  marketId: bigint;
  postgradMarket: string;
}): Promise<VenuePoolRecord[]> {
  const marketAddress = postgradMarket as `0x${string}`;
  const [yesToken, noToken] = await Promise.all([
    client.readContract({
      abi: completeSetBinaryMarketAbi,
      address: marketAddress,
      functionName: "yesToken",
    }),
    client.readContract({
      abi: completeSetBinaryMarketAbi,
      address: marketAddress,
      functionName: "noToken",
    }),
  ]);

  return buildVenuePoolRecords({
    chainId: config.chainId,
    collateral: collateral as `0x${string}`,
    marketId,
    noToken: noToken as `0x${string}`,
    postgradMarket: marketAddress,
    yesToken: yesToken as `0x${string}`,
  });
}

function rememberPoolIds(records: VenuePoolRecord[]) {
  for (const record of records) {
    knownVenuePoolIds.add(record.poolId);
  }
}
