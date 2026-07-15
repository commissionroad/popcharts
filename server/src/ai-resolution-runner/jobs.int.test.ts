import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { enqueueEligibleMarketResolutionJobs } from "src/ai-resolution-runner/jobs";
import { createIntDb, INT_DB_URL } from "src/test-support/int-db";

// Regression coverage for the enqueue query's raw SQL fragment. It binds a
// JS timestamp into `coalesce(yes_not_before, resolution_time) <= ...`
// outside drizzle's column mapping, so only the real postgres-js driver
// exercises the parameter serialization that once crashed the runner on a
// bare Date (unit tests are DB-free and PGlite serializes Dates fine).
const CHAIN_ID = 31337;
const METADATA_HASH = `0x${"44".repeat(32)}`;
const CREATOR = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const TRANSACTION_HASH = `0x${"55".repeat(32)}`;
const CREATED_AT = new Date("2026-07-01T12:00:00.000Z");
const GRADUATION_TIME = new Date("2026-07-02T00:00:00.000Z");
// Both resolution gates sit in the past so the market is enqueue-eligible.
const RESOLUTION_TIME = new Date("2026-07-03T00:00:00.000Z");

let dbc: typeof productionDb;
let teardown: (() => Promise<void>) | undefined;

describe.skipIf(!INT_DB_URL)("enqueueEligibleMarketResolutionJobs", () => {
  beforeAll(async () => {
    ({ dbc, teardown } = await createIntDb());
    setDbForTesting(dbc);

    const [contract] = await dbc
      .insert(schema.contracts)
      .values({
        address: "0x00000000000000000000000000000000000000cc",
        chainId: CHAIN_ID,
        name: "PregradManager",
      })
      .returning({ id: schema.contracts.id });
    if (!contract) {
      throw new Error("Failed to seed the contract row");
    }

    await dbc.insert(schema.marketMetadata).values({
      category: "Testing",
      chainId: CHAIN_ID,
      createdAt: CREATED_AT,
      description: "Graduated market awaiting resolution.",
      metadataCreatedAt: CREATED_AT.toISOString(),
      metadataHash: METADATA_HASH,
      question: "Will the enqueue query survive a real driver round trip?",
      resolutionCriteria: "Resolves YES when the resolution job enqueues.",
      updatedAt: CREATED_AT,
    });
    await dbc.insert(schema.markets).values({
      bypassAiResolution: false,
      chainId: CHAIN_ID,
      collateral: COLLATERAL,
      contractId: contract.id,
      createdAt: CREATED_AT,
      createdBlockNumber: 100n,
      createdBlockTimestamp: CREATED_AT,
      createdLogIndex: 0,
      createdTransactionHash: TRANSACTION_HASH,
      creator: CREATOR,
      graduationThreshold: 2_500n * 10n ** 18n,
      graduationTime: GRADUATION_TIME,
      liquidityParameter: 5_000n * 10n ** 18n,
      marketId: 1n,
      metadataHash: METADATA_HASH,
      noShares: 0n,
      openingProbabilityWad: 500_000_000_000_000_000n,
      receiptCount: 0n,
      resolutionTime: RESOLUTION_TIME,
      status: "graduated",
      totalEscrowed: 0n,
      updatedAt: CREATED_AT,
      yesNotBefore: null,
      yesShares: 0n,
    });
  }, 15_000);

  afterAll(async () => {
    setDbForTesting(null);
    await teardown?.();
  });

  it("enqueues a graduated market past its resolution gate", async () => {
    const enqueued = await enqueueEligibleMarketResolutionJobs({
      limit: 5,
      maxAttempts: 5,
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.marketId).toBe(1n);
    expect(enqueued[0]?.status).toBe("queued");
    // The hard floor falls back to resolution_time when yes_not_before is null.
    expect(enqueued[0]?.notBefore?.getTime()).toBe(RESOLUTION_TIME.getTime());
  });

  it("does not enqueue the same market twice while a job is active", async () => {
    const again = await enqueueEligibleMarketResolutionJobs({
      limit: 5,
      maxAttempts: 5,
    });

    expect(again).toHaveLength(0);
  });
});
