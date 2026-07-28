// Real-SQL tier for the keeper's venue discovery: the lifecycle filter runs
// over rows joined from graduation_finalized_events, so only a real database
// shows which markets the keeper will actually maintain. The case that matters
// is a market inside its dispute window — it has graduated, its venue is still
// trading, and the keeper must keep maintaining it for the whole window.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import type { MarketStatus } from "src/db/schema/markets";
import { discoverTrackedMarkets } from "src/keeper/discovery";
import { createPgliteDb } from "src/test-support/pglite-db";

const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const CREATOR = "0x00000000000000000000000000000000000000aa";
const METADATA_HASH = `0x${"22".repeat(32)}`;
const SEEDED_AT = new Date("2026-07-14T12:00:00.000Z");

/**
 * Every market status the keeper could meet on a market that has a
 * GraduationFinalized row, one seeded market each, so the assertion below is a
 * complete statement of which venues get maintained rather than a spot check.
 */
const SEEDED_MARKETS = [
  { marketId: 1n, status: "graduated" },
  { marketId: 2n, status: "resolution_pending" },
  { marketId: 3n, status: "disputed" },
  { marketId: 4n, status: "resolved" },
  { marketId: 5n, status: "cancelled" },
] as const satisfies readonly { marketId: bigint; status: MarketStatus }[];

let chainId: number;
let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

/**
 * A chain stub for the manifest build. Discovery only needs the reads to
 * succeed; which venue a maintained market resolves to is postgrad-venue's
 * concern, not discovery's.
 */
const publicClient = {
  readContract: async ({ functionName }: { functionName: string }) =>
    functionName === "decimals"
      ? 6
      : "0x00000000000000000000000000000000000000ce",
} as unknown as Parameters<typeof discoverTrackedMarkets>[0]["publicClient"];

beforeAll(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);

  const { config } = await import("src/config");
  chainId = config.chainId;

  const [contract] = await dbc
    .insert(schema.contracts)
    .values({
      address: config.contracts.pregradManager.toLowerCase(),
      chainId,
      name: "PregradManager",
    })
    .returning({ id: schema.contracts.id });
  if (!contract) {
    throw new Error("Failed to seed the contract row");
  }

  for (const [index, seed] of SEEDED_MARKETS.entries()) {
    await dbc.insert(schema.markets).values({
      bypassAiResolution: true,
      chainId,
      collateral: COLLATERAL,
      contractId: contract.id,
      createdAt: SEEDED_AT,
      createdBlockNumber: 100n + BigInt(index),
      createdBlockTimestamp: SEEDED_AT,
      createdLogIndex: index,
      createdTransactionHash: `0x${"66".repeat(31)}0${index}`,
      creator: CREATOR,
      graduationThreshold: 2_500n * 10n ** 18n,
      graduationTime: SEEDED_AT,
      liquidityParameter: 5_000n * 10n ** 18n,
      marketId: seed.marketId,
      metadataHash: METADATA_HASH,
      noShares: 0n,
      openingProbabilityWad: 500_000_000_000_000_000n,
      receiptCount: 0n,
      resolutionTime: SEEDED_AT,
      status: seed.status,
      totalEscrowed: 0n,
      updatedAt: SEEDED_AT,
      yesNotBefore: null,
      yesShares: 0n,
    });

    await dbc.insert(schema.graduationFinalizedEvents).values({
      blockNumber: 200n + BigInt(index),
      blockTimestamp: SEEDED_AT,
      chainId,
      completeSetCount: 2_500n * 10n ** 18n,
      contractId: contract.id,
      logIndex: index,
      marketId: seed.marketId,
      postgradAdapter: "0x00000000000000000000000000000000000000cd",
      postgradMarket: "0x00000000000000000000000000000000000000ce",
      refundTotal: 0n,
      retainedCostTotal: 2_500n * 10n ** 18n,
      transactionHash: `0x${"77".repeat(31)}0${index}`,
    });
  }
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

describe("discoverTrackedMarkets", () => {
  it("maintains venues for the whole dispute window, not just `graduated`", async () => {
    const tracked = await discoverTrackedMarkets({ publicClient });

    // Resolved and cancelled markets freeze trading, so their venues are done.
    // The two dispute-window statuses are still live: pinning the filter to
    // `graduated` would strand every market's venue unmaintained for the
    // length of its window (24h on a deployed network).
    expect(tracked.map((market) => market.key).sort()).toEqual([
      `${chainId}:1`,
      `${chainId}:2`,
      `${chainId}:3`,
    ]);
  });
});
