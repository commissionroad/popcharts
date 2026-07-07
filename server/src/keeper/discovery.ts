import type { CompleteSetMarketManifestData } from "@popcharts/protocol";
import type { createPublicClient } from "viem";

import { buildGraduatedMarketManifest } from "src/api/services/postgrad-venue";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

/** One complete-set market the keeper maintains. */
export type TrackedMarket = {
  /** Stable scheduler/log key, e.g. "31337:7" or "demo:PCSM". */
  key: string;
  label: string;
  manifest: CompleteSetMarketManifestData;
};

/** One pregrad market the keeper watches for graduation eligibility. */
export type TrackedPregradMarket = {
  chainId: number;
  graduationThreshold: bigint;
  /** Stable scheduler/log key, e.g. "pregrad:31337:7". */
  key: string;
  label: string;
  marketId: bigint;
};

/**
 * Discovers bootstrap markets the keeper should watch for graduation:
 * every indexed pregrad market still taking receipts (plus any stuck in
 * `graduating`, so an interrupted settlement resumes). Eligibility itself is
 * re-checked against live chain state at pass time — this list only decides
 * which markets get a pass at all.
 */
export async function discoverPregradMarkets(): Promise<
  TrackedPregradMarket[]
> {
  const rows = await db
    .select({
      chainId: schema.markets.chainId,
      graduationThreshold: schema.markets.graduationThreshold,
      marketId: schema.markets.marketId,
      status: schema.markets.status,
    })
    .from(schema.markets)
    .where(eq(schema.markets.chainId, config.chainId));

  return rows
    .filter((row) => row.status === "bootstrap" || row.status === "graduating")
    .map((row) => ({
      chainId: row.chainId,
      graduationThreshold: row.graduationThreshold,
      key: `pregrad:${row.chainId}:${row.marketId.toString()}`,
      label: `pregrad market ${row.chainId}:${row.marketId.toString()}`,
      marketId: row.marketId,
    }));
}

/**
 * Discovers every venue market the keeper should maintain: graduated markets
 * from the indexer's GraduationFinalized projections, plus the operator demo
 * market when its address is in the environment. Manifests are rebuilt
 * deterministically, so a market graduated minutes ago is tracked without
 * any manifest file existing.
 */
export async function discoverTrackedMarkets({
  publicClient,
}: {
  publicClient: ReturnType<typeof createPublicClient>;
}): Promise<TrackedMarket[]> {
  const tracked = new Map<string, TrackedMarket>();

  for (const row of await selectGraduatedMarkets()) {
    const key = `${row.chainId}:${row.marketId.toString()}`;

    try {
      tracked.set(key, {
        key,
        label: `market ${key}`,
        manifest: await buildGraduatedMarketManifest({
          collateral: row.collateral as `0x${string}`,
          postgradMarket: row.postgradMarket as `0x${string}`,
          publicClient,
        }),
      });
    } catch (error) {
      console.warn(`[Keeper] Skipping ${key}: manifest build failed:`, error);
    }
  }

  const demo = await discoverDemoMarket(publicClient);

  if (demo) {
    tracked.set(demo.key, demo);
  }

  return [...tracked.values()];
}

async function selectGraduatedMarkets() {
  const rows = await db
    .select({
      chainId: schema.graduationFinalizedEvents.chainId,
      collateral: schema.markets.collateral,
      marketId: schema.graduationFinalizedEvents.marketId,
      postgradMarket: schema.graduationFinalizedEvents.postgradMarket,
      status: schema.markets.status,
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

  // Resolved markets freeze trading, so the keeper only maintains venues
  // that are still live.
  return rows.filter((row) => row.status === "graduated");
}

/**
 * The operator demo market has no GraduationFinalized event; its address
 * arrives through the env written by the local deploy flow.
 */
async function discoverDemoMarket(
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<TrackedMarket | null> {
  const marketAddress =
    process.env.LOCAL_COMPLETE_SET_MARKET_ADDRESS ??
    process.env.COMPLETE_SET_MARKET_ADDRESS;
  const collateral =
    process.env.LOCAL_COLLATERAL_ADDRESS ?? process.env.COLLATERAL_ADDRESS;

  if (!marketAddress || !collateral) {
    return null;
  }

  const symbol =
    process.env.LOCAL_COMPLETE_SET_MARKET_SYMBOL ??
    process.env.COMPLETE_SET_MARKET_SYMBOL ??
    "demo";
  const key = `demo:${symbol}`;

  try {
    return {
      key,
      label: `demo market ${symbol}`,
      manifest: await buildGraduatedMarketManifest({
        collateral: collateral as `0x${string}`,
        postgradMarket: marketAddress as `0x${string}`,
        publicClient,
      }),
    };
  } catch (error) {
    console.warn(`[Keeper] Skipping ${key}: manifest build failed:`, error);
    return null;
  }
}
