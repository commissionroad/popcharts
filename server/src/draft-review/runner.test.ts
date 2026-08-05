import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import type { MarketReviewRequest, ReviewResult } from "src/ai-review/types";
import type { db as productionDb } from "src/db/client";
import { eq, schema, setDbForTesting } from "src/db/client";
import {
  draftReviewProvider,
  processDraftReviewJobsOnce,
  startDraftReviewRunner,
} from "src/draft-review/runner";

import { createPgliteDb } from "src/test-support/pglite-db";

let dbc: typeof productionDb;
let reset: () => Promise<void>;
let teardownDb: () => Promise<void>;

// One PGlite for the whole file (each instance costs ~1.2-2GB that close()
// does not return promptly); reset() gives every test a clean slate.
beforeAll(async () => {
  ({ dbc, reset, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
}, 15_000);

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

const OWNER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const HASH = `0x${"11".repeat(32)}`;
const QUESTION = "Will bitcoin close above $100k on 2027-01-01?";

function makeReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    evidence: [],
    hardFlags: [],
    promptVersion: "test-v1",
    provider: "heuristic",
    reasons: [],
    scoreRationales: {
      contentSafety: "Safe.",
      corroboration: "Corroborated.",
      disputeRisk: "Clear.",
      objectivity: "Objective.",
      promptInjectionRisk: "None.",
      publicKnowability: "Public.",
      sourceQuality: "Strong.",
    },
    scores: {
      contentSafety: 5,
      corroboration: 5,
      disputeRisk: 0,
      objectivity: 5,
      promptInjectionRisk: 0,
      publicKnowability: 5,
      sourceQuality: 5,
    },
    sourceChecks: [],
    verdict: "approve",
    ...overrides,
  };
}

/**
 * Seeds a draft locked in review of the {@link HASH} snapshot plus a due,
 * queued job for it. The runner only ever compares the stored hashes to each
 * other, so a fixed hash stands in for a real content digest.
 */
async function seedDraftAndJob({
  maxAttempts = 5,
  runAfter = new Date(Date.now() - 60_000),
  submittedMetadataHash = HASH,
}: {
  maxAttempts?: number;
  runAfter?: Date;
  submittedMetadataHash?: string;
} = {}) {
  const [draft] = await dbc
    .insert(schema.marketDrafts)
    .values({
      category: "Crypto",
      ownerUserId: OWNER,
      question: QUESTION,
      resolutionCriteria: "Resolves YES per the CoinGecko daily close.",
      resolutionSources: "https://www.coingecko.com",
      status: "in_review",
      submittedAt: new Date(),
      submittedMetadataHash,
    })
    .returning();
  const [job] = await dbc
    .insert(schema.marketDraftReviewJobs)
    .values({
      draftId: draft!.id,
      maxAttempts,
      metadataHash: HASH,
      runAfter,
    })
    .returning();

  return { draft: draft!, job: job! };
}

async function readJob(jobId: number) {
  const rows = await dbc
    .select()
    .from(schema.marketDraftReviewJobs)
    .where(eq(schema.marketDraftReviewJobs.id, jobId));

  return rows[0]!;
}

async function readDraft(draftId: number) {
  const rows = await dbc
    .select()
    .from(schema.marketDrafts)
    .where(eq(schema.marketDrafts.id, draftId));

  return rows[0]!;
}

function readReviews(draftId: number) {
  return dbc
    .select()
    .from(schema.marketDraftReviews)
    .where(eq(schema.marketDraftReviews.draftId, draftId));
}

describe("draftReviewProvider", () => {
  it("honors a valid provider value", () => {
    expect(
      draftReviewProvider({ POPCHARTS_DRAFT_REVIEW_PROVIDER: "anthropic" }),
    ).toBe("anthropic");
  });

  it("falls back to heuristic for an unknown value", () => {
    expect(
      draftReviewProvider({
        POPCHARTS_DRAFT_REVIEW_PROVIDER: "not-a-provider",
      }),
    ).toBe("heuristic");
  });

  it("defaults to heuristic when unset", () => {
    expect(draftReviewProvider({})).toBe("heuristic");
  });
});

describe("processDraftReviewJobsOnce", () => {
  it("reviews a due job, records the review, and transitions the draft", async () => {
    const { draft, job } = await seedDraftAndJob();
    const requests: MarketReviewRequest[] = [];
    const outcomes = await processDraftReviewJobsOnce(
      {},
      {
        review: async (request) => {
          requests.push(request);

          return makeReviewResult({ verdict: "approve" });
        },
      },
    );

    expect(outcomes).toEqual([
      {
        draftId: draft.id,
        jobId: job.id,
        outcome: "succeeded",
        verdict: "approve",
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.metadata.metadataHash).toBe(HASH);
    expect(requests[0]?.metadata.question).toBe(QUESTION);

    const reviews = await readReviews(draft.id);

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.verdict).toBe("approve");
    expect(reviews[0]?.metadataHash).toBe(HASH);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("succeeded");
    expect(jobRow.reviewId).toBe(reviews[0]!.id);
    expect(jobRow.attemptCount).toBe(1);
    expect(jobRow.lastError).toBeNull();
    expect(jobRow.leaseUntil).toBeNull();
    expect(jobRow.lockedBy).toBeNull();
    expect(jobRow.completedAt).not.toBeNull();

    expect((await readDraft(draft.id)).status).toBe("approved");
  });

  it("cancels a job whose draft was edited to a different snapshot", async () => {
    const { draft, job } = await seedDraftAndJob({
      submittedMetadataHash: `0x${"22".repeat(32)}`,
    });
    let reviewCalls = 0;
    const outcomes = await processDraftReviewJobsOnce(
      {},
      {
        review: async () => {
          reviewCalls += 1;

          return makeReviewResult();
        },
      },
    );

    expect(outcomes).toEqual([
      { draftId: draft.id, jobId: job.id, outcome: "cancelled" },
    ]);
    expect(reviewCalls).toBe(0);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("cancelled");
    expect(jobRow.lastError).toBe("Draft left review before the job ran.");
    expect(jobRow.completedAt).not.toBeNull();

    // The stale job changes nothing about the draft and records no review.
    expect((await readDraft(draft.id)).status).toBe("in_review");
    expect(await readReviews(draft.id)).toHaveLength(0);
  });

  it("marks a failed attempt retryable with exponential backoff", async () => {
    const { draft, job } = await seedDraftAndJob();
    const before = Date.now();
    const outcomes = await processDraftReviewJobsOnce(
      {},
      {
        review: async () => {
          throw new Error("provider exploded");
        },
      },
    );
    const after = Date.now();

    expect(outcomes).toEqual([
      { draftId: draft.id, jobId: job.id, outcome: "failed" },
    ]);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("retryable_failed");
    expect(jobRow.attemptCount).toBe(1);
    expect(jobRow.lastError).toBe("provider exploded");
    expect(jobRow.leaseUntil).toBeNull();
    expect(jobRow.lockedBy).toBeNull();
    expect(jobRow.completedAt).toBeNull();
    // First failure backs off by RETRY_BASE_MS (15s), anchored at wall time.
    expect(jobRow.runAfter.getTime()).toBeGreaterThanOrEqual(before + 15_000);
    expect(jobRow.runAfter.getTime()).toBeLessThanOrEqual(after + 15_000);

    // The draft stays locked in review awaiting the retry.
    expect((await readDraft(draft.id)).status).toBe("in_review");
    expect(await readReviews(draft.id)).toHaveLength(0);
  });

  it("releases the draft back to editing on a terminal failure", async () => {
    const { draft, job } = await seedDraftAndJob({ maxAttempts: 1 });
    const outcomes = await processDraftReviewJobsOnce(
      {},
      {
        review: async () => {
          throw new Error("provider exploded");
        },
      },
    );

    expect(outcomes).toEqual([
      { draftId: draft.id, jobId: job.id, outcome: "failed" },
    ]);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("terminal_failed");
    expect(jobRow.completedAt).not.toBeNull();

    expect((await readDraft(draft.id)).status).toBe("editing");
    expect(await readReviews(draft.id)).toHaveLength(0);
  });

  it("is a no-op on an empty queue", async () => {
    expect(await processDraftReviewJobsOnce()).toEqual([]);
  });

  it("leaves jobs that are not yet due unclaimed", async () => {
    const { job } = await seedDraftAndJob({
      runAfter: new Date(Date.now() + 60_000),
    });

    expect(await processDraftReviewJobsOnce()).toEqual([]);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("queued");
    expect(jobRow.attemptCount).toBe(0);
  });
});

describe("startDraftReviewRunner", () => {
  it("starts and stops before the first sweep", () => {
    const stop = startDraftReviewRunner({ intervalMs: 60_000 });

    expect(typeof stop).toBe("function");
    stop();
  });

  it("routes sweep failures to onError and keeps ticking until stopped", async () => {
    // Poison the ambient db handle so every sweep throws deterministically —
    // no timers to fake and no network involved.
    const poisonedDb = new Proxy(
      {},
      {
        get() {
          throw new Error("poisoned sweep");
        },
      },
    ) as unknown as typeof productionDb;

    setDbForTesting(poisonedDb);

    try {
      const errors: unknown[] = [];
      const stop = startDraftReviewRunner({
        intervalMs: 5,
        onError: (error) => {
          errors.push(error);
        },
      });
      // Two errors prove the loop reschedules after a failed sweep rather
      // than dying on the first one. The deadline only bounds a failure.
      const deadline = Date.now() + 5_000;

      while (errors.length < 2 && Date.now() < deadline) {
        await Bun.sleep(10);
      }

      stop();
      expect(errors.length).toBeGreaterThanOrEqual(2);
      expect((errors[0] as Error).message).toBe("poisoned sweep");
    } finally {
      setDbForTesting(dbc);
    }
  });
});
