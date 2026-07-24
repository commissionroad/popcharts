import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

const MARKET_ID = 91n;
const TOO_EARLY_MARKET_ID = 92n;
const PREGRAD_MARKET_ID = 93n;
const METADATA_HASH = `0x${"77".repeat(32)}`;
const CREATOR = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const TRANSACTION_HASH = `0x${"88".repeat(32)}`;
const CREATED_AT = new Date("2026-07-01T12:00:00.000Z");
const PAST_RESOLUTION_TIME = new Date("2026-07-10T00:00:00.000Z");
const FUTURE_RESOLUTION_TIME = new Date("2099-01-01T00:00:00.000Z");

let app: (typeof import("src/api"))["app"];
let chainId: number;
let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

async function seedMarket(
  marketId: bigint,
  options: {
    contractId: number;
    resolutionTime: Date;
    status: "bootstrap" | "graduated";
  },
) {
  await dbc.insert(schema.markets).values({
    bypassAiResolution: false,
    chainId,
    collateral: COLLATERAL,
    contractId: options.contractId,
    createdAt: CREATED_AT,
    createdBlockNumber: 50n + marketId,
    createdBlockTimestamp: CREATED_AT,
    // The (tx, logIndex) pair is unique-indexed; vary it per seeded market.
    createdLogIndex: Number(marketId),
    createdTransactionHash: TRANSACTION_HASH,
    creator: CREATOR,
    graduationThreshold: 2_500n * 10n ** 18n,
    graduationTime: CREATED_AT,
    liquidityParameter: 5_000n * 10n ** 18n,
    marketId,
    metadataHash: METADATA_HASH,
    noShares: 0n,
    openingProbabilityWad: 500_000_000_000_000_000n,
    receiptCount: 0n,
    resolutionTime: options.resolutionTime,
    status: options.status,
    totalEscrowed: 0n,
    updatedAt: CREATED_AT,
    yesNotBefore: null,
    yesShares: 0n,
  });
}

beforeAll(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);

  const { config } = await import("src/config");
  chainId = config.chainId;

  const [contract] = await dbc
    .insert(schema.contracts)
    .values({
      address: "0x00000000000000000000000000000000000000cc",
      chainId,
      name: "PregradManager",
    })
    .returning({ id: schema.contracts.id });
  if (!contract) {
    throw new Error("Failed to seed the contract row");
  }

  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId,
    createdAt: CREATED_AT,
    description: "Resolution-request route market.",
    metadataCreatedAt: CREATED_AT.toISOString(),
    metadataHash: METADATA_HASH,
    question: "Did the requested event happen?",
    resolutionCriteria: "Resolves YES when the event is confirmed.",
    updatedAt: CREATED_AT,
  });

  await seedMarket(MARKET_ID, {
    contractId: contract.id,
    resolutionTime: PAST_RESOLUTION_TIME,
    status: "graduated",
  });
  await seedMarket(TOO_EARLY_MARKET_ID, {
    contractId: contract.id,
    resolutionTime: FUTURE_RESOLUTION_TIME,
    status: "graduated",
  });
  await seedMarket(PREGRAD_MARKET_ID, {
    contractId: contract.id,
    resolutionTime: PAST_RESOLUTION_TIME,
    status: "bootstrap",
  });

  ({ app } = await import("src/api"));
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

async function requestCheck(marketId: bigint | string) {
  const response = await app.handle(
    new Request(
      `http://localhost/markets/${chainId}/${marketId}/resolution-check`,
      { method: "POST" },
    ),
  );
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  return {
    body: isJson ? await response.json() : await response.text(),
    status: response.status,
  };
}

describe("POST /markets/:chainId/:marketId/resolution-check", () => {
  it("queues a job for an eligible market and reports the queued job on repeat", async () => {
    const first = await requestCheck(MARKET_ID);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("queued");

    const jobs = await dbc.select().from(schema.marketResolutionJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.marketId).toBe(MARKET_ID);
    expect(jobs[0]?.trigger).toBe("manual");
    expect(jobs[0]?.status).toBe("queued");

    // While that job is live, repeat requests acknowledge rather than stack.
    const second = await requestCheck(MARKET_ID);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("already_queued");
  });

  it("cools down after the job completes instead of re-queueing same-day", async () => {
    await dbc
      .update(schema.marketResolutionJobs)
      .set({ status: "terminal_failed" });

    const result = await requestCheck(MARKET_ID);
    expect(result.status).toBe(409);
    expect(result.body.status).toBe("cooling_down");
    // The retry hint is the job's creation time plus the 24h cooldown.
    expect(typeof result.body.eligibleAt).toBe("string");
  });

  it("refuses a market before its earliest resolution time", async () => {
    const result = await requestCheck(TOO_EARLY_MARKET_ID);
    expect(result.status).toBe(409);
    expect(result.body.status).toBe("too_early");
    expect(result.body.eligibleAt).toBe(FUTURE_RESOLUTION_TIME.toISOString());
  });

  it("refuses an ungraduated market", async () => {
    const result = await requestCheck(PREGRAD_MARKET_ID);
    expect(result.status).toBe(409);
    expect(result.body.status).toBe("not_eligible");
  });

  it("refuses a market the resolver already evaluated", async () => {
    await dbc.insert(schema.marketResolutions).values({
      chainId,
      evidence: [],
      hardFlags: [],
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      outcome: "yes",
      promptVersion: "market-ai-resolution-v1",
      provider: "manual",
      reasons: ["Operator recorded the outcome."],
      sourceChecks: [],
      verdict: "resolve_yes",
    });

    const result = await requestCheck(MARKET_ID);
    expect(result.status).toBe(409);
    expect(result.body.status).toBe("already_evaluated");
  });

  it("rejects an unknown market and a malformed id", async () => {
    expect((await requestCheck(4_040n)).status).toBe(404);
    expect((await requestCheck("not-a-number")).status).toBe(400);
  });
});
