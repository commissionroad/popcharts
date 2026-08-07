// Real-SQL cover for the enqueue guard. `noResolutionForCurrentMarket()` is a
// correlated `not exists` fragment, so only real SQL can show which rows it
// counts — and after ADR 0026 that distinction is what keeps a market whose
// proposal never landed from falling out of the system permanently.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { eq } from "drizzle-orm";

import type { ResolutionResult } from "src/ai-resolution/types";

import type { db as productionDb } from "src/db/client";
import { setDbForTesting } from "src/db/client";
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

import type { AiResolutionRunnerConfig } from "./config";
import {
  enqueueEligibleMarketResolutionJobs,
  processResolutionJob,
  type ClaimedResolutionJob,
  type ResolutionJobDependencies,
} from "./jobs";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;
// Both resolution gates sit in the past, so the market is enqueue-eligible.
const RESOLUTION_TIME = new Date("2026-07-03T00:00:00.000Z");
const NOW = new Date("2026-07-20T00:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

function resolutionRow(
  commitState: "confirmed" | "pending",
): typeof schema.marketResolutions.$inferInsert {
  return {
    chainId: CHAIN_ID,
    commitState,
    evidence: [],
    hardFlags: [],
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    outcome: "yes",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["Because."],
    sourceChecks: [],
    verdict: "resolve_yes",
  };
}

async function seedGraduatedMarket() {
  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: CHAIN_ID,
    description: "A graduated market awaiting resolution.",
    metadataCreatedAt: "2026-07-01T00:00:00.000Z",
    metadataHash: METADATA_HASH,
    question: "Does the enqueue guard count only confirmed rows?",
    resolutionCriteria: "Resolves YES when it does.",
  });
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-07-01T00:00:00.000Z"),
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: "0x00000000000000000000000000000000000000aa",
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-07-02T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: RESOLUTION_TIME,
    status: "graduated",
  });
}

async function enqueue() {
  return await enqueueEligibleMarketResolutionJobs({
    limit: 10,
    maxAttempts: 5,
    now: NOW,
  });
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

beforeEach(async () => {
  await resetDb();
  await seedGraduatedMarket();
});

describe("enqueueEligibleMarketResolutionJobs", () => {
  it("enqueues a graduated market past its resolution gate", async () => {
    expect(await enqueue()).toHaveLength(1);
  });

  it("skips a market whose resolution is confirmed", async () => {
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("confirmed"));

    expect(await enqueue()).toHaveLength(0);
  });

  // The reason this guard exists. The runner writes its judgment `pending`
  // before proposing, so an unqualified existence check would read that row as
  // "already resolved" and drop the market out of enqueue for good — even
  // though the proposal may never have reached the chain.
  it("still enqueues a market whose only row is pending", async () => {
    await dbc.insert(schema.marketResolutions).values(resolutionRow("pending"));

    expect(await enqueue()).toHaveLength(1);
  });

  it("skips once a pending row is confirmed", async () => {
    const [row] = await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("pending"))
      .returning();
    expect(await enqueue()).toHaveLength(1);

    // Clear the job the first pass created; the active-job guard would
    // otherwise mask what this test is actually about.
    await dbc.delete(schema.marketResolutionJobs);
    await dbc
      .update(schema.marketResolutions)
      .set({ commitState: "confirmed" })
      .where(eq(schema.marketResolutions.id, row?.id ?? -1));

    expect(await enqueue()).toHaveLength(0);
  });
});

const POSTGRAD_MARKET =
  "0x00000000000000000000000000000000000000ee" as `0x${string}`;

const CONFIG: AiResolutionRunnerConfig = {
  backoffMs: 30_000,
  batchSize: 5,
  corroborationEnabled: false,
  leaseMs: 1_200_000,
  maxAttempts: 5,
  pollMs: 1_000,
  requestTimeoutMs: 30_000,
  runnerId: "test-runner",
  serviceUrl: "http://127.0.0.1:3004",
};

function modelResult(
  overrides: Partial<ResolutionResult> = {},
): ResolutionResult {
  return {
    confidence: 0.95,
    evidence: [],
    hardFlags: [],
    outcome: "yes",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["The event concluded YES."],
    sourceChecks: [],
    verdict: "resolve_yes",
    ...overrides,
  };
}

async function claimJob(): Promise<ClaimedResolutionJob> {
  const [job] = await dbc
    .insert(schema.marketResolutionJobs)
    .values({
      chainId: CHAIN_ID,
      lockedBy: CONFIG.runnerId,
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      status: "running",
    })
    .returning();
  const [market] = await dbc.select().from(schema.markets);
  const [metadata] = await dbc.select().from(schema.marketMetadata);
  if (!job || !market || !metadata) {
    throw new Error("Failed to seed the claimed job");
  }

  return { job, market, metadata, postgradMarketAddress: POSTGRAD_MARKET };
}

function makeDependencies(overrides: Partial<ResolutionJobDependencies> = {}): {
  calls: string[];
  dependencies: ResolutionJobDependencies;
  rowsAtProposeTime: (typeof schema.marketResolutions.$inferSelect)[];
} {
  const calls: string[] = [];
  const rowsAtProposeTime: (typeof schema.marketResolutions.$inferSelect)[] =
    [];

  return {
    calls,
    dependencies: {
      proposeMarketResolutionOnChain: async () => {
        calls.push("propose");
        // The ordering claim, checked from inside the chain call: whatever the
        // runner intends to submit must already be committed by now.
        rowsAtProposeTime.push(
          ...(await dbc.select().from(schema.marketResolutions)),
        );
        return {
          blockTimestamp: new Date("2026-07-21T00:00:00.000Z"),
          kind: "proposed",
          transactionHash: `0x${"11".repeat(32)}`,
        };
      },
      resolveMarketWithService: async () => {
        calls.push("model");
        return modelResult();
      },
      ...overrides,
    },
    rowsAtProposeTime,
  };
}

describe("processResolutionJob writes its intent before proposing", () => {
  it("commits a pending row before the chain call, not after", async () => {
    const claimed = await claimJob();
    const { calls, dependencies, rowsAtProposeTime } = makeDependencies();

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(calls).toEqual(["model", "propose"]);
    expect(rowsAtProposeTime).toHaveLength(1);
    expect(rowsAtProposeTime[0]).toMatchObject({
      commitState: "pending",
      resolvedAt: null,
      verdict: "resolve_yes",
    });
  });

  it("leaves the row pending — confirming it is the indexer's transition", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies();

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [row] = await dbc.select().from(schema.marketResolutions);
    expect(row?.commitState).toBe("pending");
    expect(outcome.status).toBe("succeeded");
  });

  it("points the job at its pending row and completes it", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies();

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [row] = await dbc.select().from(schema.marketResolutions);
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      leaseUntil: null,
      lockedBy: null,
      resolutionId: row?.id,
      status: "succeeded",
    });
  });

  // The defect this whole change exists to remove: the judgment survives a
  // crash after the chain call, so the retry never has to derive a new one.
  it("resumes a pending row without calling the model again", async () => {
    const first = await claimJob();
    const { dependencies } = makeDependencies();
    await processResolutionJob({
      claimed: first,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    // Simulate the completion write having failed: the row stands, the job is
    // claimable again.
    await dbc
      .update(schema.marketResolutionJobs)
      .set({ status: "running" })
      .where(eq(schema.marketResolutionJobs.id, first.job.id));

    const retryDeps = makeDependencies({
      resolveMarketWithService: async () => {
        throw new Error("the model must not be called on a resumed job");
      },
    });
    const outcome = await processResolutionJob({
      claimed: first,
      config: CONFIG,
      dependencies: retryDeps.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(retryDeps.calls).toEqual(["propose"]);
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(1);
  });

  it("does nothing at all once the row is confirmed", async () => {
    const first = await claimJob();
    const { dependencies } = makeDependencies();
    await processResolutionJob({
      claimed: first,
      config: CONFIG,
      dependencies,
      now: NOW,
    });
    await dbc
      .update(schema.marketResolutions)
      .set({ commitState: "confirmed" });
    await dbc
      .update(schema.marketResolutionJobs)
      .set({ status: "running" })
      .where(eq(schema.marketResolutionJobs.id, first.job.id));

    const retryDeps = makeDependencies({
      proposeMarketResolutionOnChain: async () => {
        throw new Error("nothing should be proposed for a confirmed row");
      },
      resolveMarketWithService: async () => {
        throw new Error("the model must not be called for a confirmed row");
      },
    });
    const outcome = await processResolutionJob({
      claimed: first,
      config: CONFIG,
      dependencies: retryDeps.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(retryDeps.calls).toEqual([]);
  });

  // A parked verdict never reaches the chain, so there is no window to protect
  // and no indexer event will ever follow. It lands confirmed on arrival.
  it("writes a parked verdict confirmed, without proposing", async () => {
    const claimed = await claimJob();
    const { calls, dependencies } = makeDependencies({
      resolveMarketWithService: async () =>
        modelResult({ outcome: "abstain", verdict: "manual_review" }),
    });

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [row] = await dbc.select().from(schema.marketResolutions);
    expect(row).toMatchObject({
      commitState: "confirmed",
      resolvedAt: NOW,
      verdict: "manual_review",
    });
    expect(calls).toEqual([]);
  });

  it("completes the job when the proposal was already standing", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies({
      proposeMarketResolutionOnChain: async () => ({
        kind: "already_proposed",
      }),
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome).toMatchObject({
      proposedOnChain: false,
      status: "succeeded",
    });
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job?.status).toBe("succeeded");
  });
});
