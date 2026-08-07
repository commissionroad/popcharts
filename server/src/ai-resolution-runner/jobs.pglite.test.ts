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
import {
  RESOLUTION_FIXTURE,
  resolutionRowValues,
  seedResolutionMarket,
} from "src/test-support/resolution-fixtures";

import type { AiResolutionRunnerConfig } from "./config";
import {
  enqueueEligibleMarketResolutionJobs,
  processResolutionJob,
  type ClaimedResolutionJob,
  type ResolutionJobDependencies,
} from "./jobs";

// Both resolution gates sit in the past, so the market is enqueue-eligible.
const {
  chainId: CHAIN_ID,
  marketId: MARKET_ID,
  metadataHash: METADATA_HASH,
} = RESOLUTION_FIXTURE;
const NOW = new Date("2026-07-20T00:00:00.000Z");

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

const resolutionRow = (commitState: "confirmed" | "pending") =>
  resolutionRowValues({ commitState });

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
  await seedResolutionMarket(dbc);
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

  // The churn-loop guard (ADR 0026 review, blocker): a resolution_pending
  // market carries someone's proposal already. If it stayed enqueue-eligible,
  // a market whose proposal was not this runner's would re-enqueue every poll
  // cycle forever — nothing ever writes the confirmed row that terminates the
  // loop. Crash recovery flows through the still-active job, never a new one.
  it("never creates a job for a market that already carries a proposal", async () => {
    await dbc
      .update(schema.markets)
      .set({ status: "resolution_pending" })
      .where(eq(schema.markets.marketId, MARKET_ID));

    expect(await enqueue()).toHaveLength(0);
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

const POSTGRAD_MARKET = RESOLUTION_FIXTURE.postgradMarketAddress;

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
  // Probe note: the reads below run on the same PGlite session as the writer,
  // so what this pins is WRITE ORDER (insert issued before propose), which is
  // the regression that matters — a revert to propose-first fails the calls
  // assertion. Cross-connection commit visibility is not observable on
  // single-session PGlite and is carried by the transaction boundary instead.
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

    // Simulate a re-claim after the completion write failed: the row stands,
    // and a real claim restores BOTH running and lockedBy — the completion
    // fence checks ownership, not just status.
    await dbc
      .update(schema.marketResolutionJobs)
      .set({ lockedBy: CONFIG.runnerId, status: "running" })
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
    const rows = await dbc.select().from(schema.marketResolutions);
    expect(rows).toHaveLength(1);
    // The adopt path must link the job to the row it resumed — its row was
    // inserted by the earlier attempt, so completion is the only writer left.
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job?.resolutionId).toBe(rows[0]!.id);
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
      .set({ lockedBy: CONFIG.runnerId, status: "running" })
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

describe("lease fencing (ADR 0026 review)", () => {
  // Default config makes this reachable in normal operation: a batch's tail
  // job can outlive its lease while a second runner reclaims it. The stale
  // runner must stop, not overwrite the new owner's state.
  it("reports lease_lost instead of completing a job another runner reclaimed", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies();
    await dbc
      .update(schema.marketResolutionJobs)
      .set({ lockedBy: "other-runner" })
      .where(eq(schema.marketResolutionJobs.id, claimed.job.id));

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("lease_lost");
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({ lockedBy: "other-runner", status: "running" });
  });

  it("rolls the judgment insert back when the lease is lost mid-persist", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies({
      resolveMarketWithService: async () => {
        // The lease is lost while the model call is in flight; the fenced
        // job-link update inside persistPendingResolution must then roll the
        // whole transaction back, leaving no orphan pending row to collide
        // with the new owner's insert.
        await dbc
          .update(schema.marketResolutionJobs)
          .set({ lockedBy: "other-runner" })
          .where(eq(schema.marketResolutionJobs.id, claimed.job.id));
        return modelResult();
      },
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("lease_lost");
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(0);
  });

  it("does not stamp a stale failure over a reclaimed job", async () => {
    const claimed = await claimJob();
    const { dependencies } = makeDependencies({
      resolveMarketWithService: async () => {
        await dbc
          .update(schema.marketResolutionJobs)
          .set({ lockedBy: "other-runner" })
          .where(eq(schema.marketResolutionJobs.id, claimed.job.id));
        throw new Error("model exploded after the lease was lost");
      },
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    // The failure writer's fence matched nothing, so the new owner's state
    // stands untouched — no lastError, no retryable_failed flip.
    expect(outcome.status).toBe("lease_lost");
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      lastError: null,
      lockedBy: "other-runner",
      status: "running",
    });
  });
});
