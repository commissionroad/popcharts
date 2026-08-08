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

import { asc, eq } from "drizzle-orm";

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

const resolutionRow = (commitState: "confirmed" | "pending" | "superseded") =>
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

  // Supporting corroboration rows (ADR 0019) and lost-race judgments both land
  // `superseded`. Neither records an on-chain fact, so neither may count as an
  // existing resolution here.
  it("still enqueues a market whose only row is superseded", async () => {
    await dbc
      .insert(schema.marketResolutions)
      .values(resolutionRow("superseded"));

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

const CORROBORATING_CONFIG: AiResolutionRunnerConfig = {
  ...CONFIG,
  corroborationEnabled: true,
};

/**
 * Dependencies stub that hands out one scripted result per service call and
 * records every proposed verdict. Throws on a call past the script's end, so
 * each test pins its exact service-call count twice: by the counter and by
 * the script length.
 */
function scriptedDependencies(results: ResolutionResult[]): {
  dependencies: ResolutionJobDependencies;
  proposedVerdicts: string[];
  serviceCalls: () => number;
} {
  let serviceCalls = 0;
  const proposedVerdicts: string[] = [];

  return {
    dependencies: {
      proposeMarketResolutionOnChain: async ({ verdict }) => {
        proposedVerdicts.push(verdict);
        return {
          blockTimestamp: new Date("2026-07-21T00:00:00.000Z"),
          kind: "proposed",
          transactionHash: `0x${"11".repeat(32)}`,
        };
      },
      resolveMarketWithService: async () => {
        const result = results[serviceCalls];
        serviceCalls += 1;
        if (!result) {
          throw new Error(`Unexpected service call #${serviceCalls}.`);
        }
        return result;
      },
    },
    proposedVerdicts,
    serviceCalls: () => serviceCalls,
  };
}

async function resolutionRowsById() {
  return await dbc
    .select()
    .from(schema.marketResolutions)
    .orderBy(asc(schema.marketResolutions.id));
}

// The exact-call-count and row-count assertions are the regression guard for
// the ADR 0019 wiring: a rewrite that drops corroboration collapses 2 calls /
// 2 rows to 1 / 1 and goes red here. Supporting rows land `superseded` with
// their own verdicts; the deciding row is inserted last, so it is the max-id
// row every latest-row reader picks.
describe("processResolutionJob corroborates terminal verdicts (ADR 0019)", () => {
  it("confirms a terminal verdict with a second agreeing run", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult(),
      modelResult({ reasons: ["second opinion agrees"] }),
    ]);

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(scripted.serviceCalls()).toBe(2);
    expect(scripted.proposedVerdicts).toEqual(["resolve_yes"]);
    const rows = await resolutionRowsById();
    expect(rows).toHaveLength(2);
    // Run 1 is audit-only: overruled by the deciding run, never proposed, no
    // chain moment — so no resolvedAt and no pending state to settle.
    expect(rows[0]).toMatchObject({
      commitState: "superseded",
      reasons: ["The event concluded YES."],
      resolvedAt: null,
      verdict: "resolve_yes",
    });
    // The corroborated (second) result decides, and the proposing row is the
    // one the job points at.
    expect(rows[1]).toMatchObject({
      commitState: "pending",
      reasons: ["second opinion agrees"],
      verdict: "resolve_yes",
    });
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      resolutionId: rows[1]?.id,
      status: "succeeded",
    });
  });

  it("proposes the flipped side after a 2-of-3 tiebreak", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult(),
      modelResult({ outcome: "no", verdict: "resolve_no" }),
      modelResult({
        outcome: "no",
        reasons: ["tiebreak agrees with NO"],
        verdict: "resolve_no",
      }),
    ]);

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(scripted.serviceCalls()).toBe(3);
    expect(scripted.proposedVerdicts).toEqual(["resolve_no"]);
    const rows = await resolutionRowsById();
    expect(rows).toHaveLength(3);
    // Supporting rows record each run's OWN verdict, in call order.
    expect(rows[0]).toMatchObject({
      commitState: "superseded",
      verdict: "resolve_yes",
    });
    expect(rows[1]).toMatchObject({
      commitState: "superseded",
      verdict: "resolve_no",
    });
    expect(rows[2]).toMatchObject({
      commitState: "pending",
      reasons: ["tiebreak agrees with NO"],
      verdict: "resolve_no",
    });
  });

  it("demotes to manual_review when no majority forms, without proposing", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult(),
      modelResult({ outcome: "no", verdict: "resolve_no" }),
      modelResult({ outcome: "abstain", verdict: "manual_review" }),
    ]);

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(scripted.serviceCalls()).toBe(3);
    expect(scripted.proposedVerdicts).toEqual([]);
    // The demoted decision is synthesized, so all three actual runs persist
    // as supporting rows and the deciding park row makes four.
    const rows = await resolutionRowsById();
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => [row.commitState, row.verdict])).toEqual([
      ["superseded", "resolve_yes"],
      ["superseded", "resolve_no"],
      ["superseded", "manual_review"],
      ["confirmed", "manual_review"],
    ]);
    // A demotion parks: confirmed on arrival, disagreement recorded first.
    expect(rows[3]).toMatchObject({ resolvedAt: NOW });
    expect(rows[3]?.reasons[0]).toContain("Corroboration");
  });

  // A tiebreak flip must pass its own time gate, not inherit the original's:
  // a NO landing before the deadline re-queues to it, and the attempt
  // persists nothing — the supporting runs are discarded with it.
  it("requeues a flipped verdict that fails its own time gate", async () => {
    const futureDeadline = new Date("2026-08-01T00:00:00.000Z");
    await dbc.update(schema.markets).set({
      resolutionTime: futureDeadline,
      yesNotBefore: new Date("2026-07-02T00:00:00.000Z"),
    });
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult(),
      modelResult({ outcome: "no", verdict: "resolve_no" }),
      modelResult({ outcome: "no", verdict: "resolve_no" }),
    ]);

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("requeued");
    expect(scripted.serviceCalls()).toBe(3);
    expect(scripted.proposedVerdicts).toEqual([]);
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(0);
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      runAfter: futureDeadline,
      status: "queued",
    });
  });

  // The corroboration-specific fence: the renewal before run 2 notices the
  // loss, so the stale attempt stops before spending more model budget — and
  // long before it could race the new owner's proposal.
  it("stops before run 2 when the lease is stolen mid-corroboration", async () => {
    const claimed = await claimJob();
    let serviceCalls = 0;
    const scripted = scriptedDependencies([]);
    const dependencies: ResolutionJobDependencies = {
      ...scripted.dependencies,
      resolveMarketWithService: async () => {
        serviceCalls += 1;
        if (serviceCalls > 1) {
          throw new Error("run 2 must not start after the lease is lost");
        }
        // Steal the lease while run 1 is in flight, so the renewal before
        // run 2 matches zero rows.
        await dbc
          .update(schema.marketResolutionJobs)
          .set({ lockedBy: "thief-runner" })
          .where(eq(schema.marketResolutionJobs.id, claimed.job.id));
        return modelResult();
      },
    };

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("lease_lost");
    expect(serviceCalls).toBe(1);
    expect(scripted.proposedVerdicts).toEqual([]);
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(0);
    // The thief's claim stands untouched: still running, still theirs, no
    // failure recorded against it.
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      lastError: null,
      lockedBy: "thief-runner",
      status: "running",
    });
  });

  // The other end of the widened steal window: corroboration puts two more
  // service calls between claim and persist, so a steal can also land after
  // run 3 — past every renewal — leaving the persist fence as the only guard.
  // On the demotion path that persist is the parked one, and it must roll the
  // park row AND the supporting rows back rather than stamping the thief's
  // reclaimed job `succeeded`.
  it("rolls a demoted park back when the lease is stolen after run 3", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult(),
      modelResult({ outcome: "no", verdict: "resolve_no" }),
      modelResult({ outcome: "abstain", verdict: "manual_review" }),
    ]);
    const dependencies: ResolutionJobDependencies = {
      ...scripted.dependencies,
      resolveMarketWithService: async (args) => {
        const result =
          await scripted.dependencies.resolveMarketWithService(args);
        if (scripted.serviceCalls() === 3) {
          // Steal the lease while run 3 is in flight: both renewals already
          // passed, so only the fenced completion inside the persist
          // transaction can notice the loss.
          await dbc
            .update(schema.marketResolutionJobs)
            .set({ lockedBy: "thief-runner" })
            .where(eq(schema.marketResolutionJobs.id, claimed.job.id));
        }
        return result;
      },
    };

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("lease_lost");
    expect(scripted.serviceCalls()).toBe(3);
    expect(scripted.proposedVerdicts).toEqual([]);
    // The transaction rolled back whole: no confirmed park row, and no
    // orphaned superseded supporting rows either.
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(0);
    // The thief's claim stands untouched: still running, still theirs, no
    // failure recorded against it.
    const [job] = await dbc.select().from(schema.marketResolutionJobs);
    expect(job).toMatchObject({
      lastError: null,
      lockedBy: "thief-runner",
      status: "running",
    });
  });

  it("single-passes the deterministic heuristic provider", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([
      modelResult({ provider: "heuristic" }),
    ]);

    const outcome = await processResolutionJob({
      claimed,
      config: CORROBORATING_CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(scripted.serviceCalls()).toBe(1);
    expect(scripted.proposedVerdicts).toEqual(["resolve_yes"]);
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(1);
  });

  it("makes one service call and one row when corroboration is off", async () => {
    const claimed = await claimJob();
    const scripted = scriptedDependencies([modelResult()]);

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies: scripted.dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");
    expect(scripted.serviceCalls()).toBe(1);
    expect(scripted.proposedVerdicts).toEqual(["resolve_yes"]);
    expect(await dbc.select().from(schema.marketResolutions)).toHaveLength(1);
  });
});
