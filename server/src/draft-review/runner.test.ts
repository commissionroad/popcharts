import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { newDraftPublicId } from "src/drafts/public-id";
import type { MarketReviewRequest, ReviewResult } from "src/ai-review/types";
import { getMarketDraft } from "src/api/services/market-drafts";
import type { db as productionDb } from "src/db/client";
import { eq, schema, setDbForTesting } from "src/db/client";
import {
  draftReviewCallConfig,
  draftReviewCorroborationEnabled,
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
      publicId: newDraftPublicId(),
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

// Pins the production wiring of the default review dependency: ADR 0019's
// corroboration is only sound while provider outages throw into the retry
// path instead of degrading to heuristic-provider results.
describe("draftReviewCallConfig", () => {
  it("always retries provider failures", () => {
    expect(draftReviewCallConfig({}).retryProviderFailures).toBe(true);
    expect(
      draftReviewCallConfig({ POPCHARTS_DRAFT_REVIEW_PROVIDER: "anthropic" })
        .retryProviderFailures,
    ).toBe(true);
  });

  it("follows draftReviewProvider for the provider", () => {
    const modelEnv = { POPCHARTS_DRAFT_REVIEW_PROVIDER: "anthropic" };

    expect(draftReviewCallConfig(modelEnv).provider).toBe(
      draftReviewProvider(modelEnv),
    );
    expect(draftReviewCallConfig(modelEnv).provider).toBe("anthropic");
    expect(draftReviewCallConfig({}).provider).toBe(draftReviewProvider({}));
    expect(draftReviewCallConfig({}).provider).toBe("heuristic");
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

describe("draftReviewCorroborationEnabled", () => {
  it("defaults to false and honors an explicit true", () => {
    expect(draftReviewCorroborationEnabled({})).toBe(false);
    expect(
      draftReviewCorroborationEnabled({
        POPCHARTS_DRAFT_REVIEW_CORROBORATION: "true",
      }),
    ).toBe(true);
  });
});

// Corroboration only fires for a configured model provider; the stubbed
// dependency means no real provider is ever invoked.
describe("processDraftReviewJobsOnce corroboration", () => {
  beforeEach(() => {
    process.env.POPCHARTS_DRAFT_REVIEW_PROVIDER = "ollama";
    // Corroboration defaults to off, so these cases opt in explicitly. The
    // one case that asserts the disabled path overrides this to "false".
    process.env.POPCHARTS_DRAFT_REVIEW_CORROBORATION = "true";
  });

  afterEach(() => {
    delete process.env.POPCHARTS_DRAFT_REVIEW_PROVIDER;
    delete process.env.POPCHARTS_DRAFT_REVIEW_CORROBORATION;
  });

  /** Scripted review dependency: replays results in order, counts calls. */
  function scriptedReview(script: (() => Promise<ReviewResult>)[]) {
    let calls = 0;
    return {
      calls: () => calls,
      review: async () => {
        const step = script[calls];
        calls += 1;
        if (!step) {
          throw new Error(`Unexpected review call #${calls}.`);
        }
        return step();
      },
    };
  }

  async function readReviewsById(draftId: number) {
    const rows = await readReviews(draftId);
    return rows.sort((a, b) => a.id - b.id);
  }

  it("confirms a model approve with a second run before committing", async () => {
    const { draft, job } = await seedDraftAndJob();
    const approve = async () =>
      makeReviewResult({ provider: "ollama", verdict: "approve" });
    const dependency = scriptedReview([approve, approve]);
    const outcomes = await processDraftReviewJobsOnce({}, dependency);

    expect(outcomes).toEqual([
      {
        draftId: draft.id,
        jobId: job.id,
        outcome: "succeeded",
        verdict: "approve",
      },
    ]);
    expect(dependency.calls()).toBe(2);

    // Both runs persist; the deciding row is the newest so the latest-review
    // readers surface it without a marker column.
    const reviews = await readReviewsById(draft.id);

    expect(reviews).toHaveLength(2);
    const deciding = reviews[reviews.length - 1]!;

    expect(deciding.verdict).toBe("approve");
    expect((await readJob(job.id)).reviewId).toBe(deciding.id);
    expect((await readDraft(draft.id)).status).toBe("approved");

    const found = await getMarketDraft({
      draftId: draft.publicId,
      owner: OWNER,
    });

    expect(found.kind === "found" && found.draft.latestReview?.id).toBe(
      deciding.id,
    );
  });

  it("demotes a three-way disagreement and persists every run", async () => {
    const { draft, job } = await seedDraftAndJob();
    const dependency = scriptedReview([
      async () => makeReviewResult({ provider: "ollama", verdict: "approve" }),
      async () => makeReviewResult({ provider: "ollama", verdict: "reject" }),
      async () =>
        makeReviewResult({ provider: "ollama", verdict: "manual_review" }),
    ]);
    const outcomes = await processDraftReviewJobsOnce({}, dependency);

    expect(outcomes).toEqual([
      {
        draftId: draft.id,
        jobId: job.id,
        outcome: "succeeded",
        verdict: "manual_review",
      },
    ]);
    expect(dependency.calls()).toBe(3);

    // Three supporting rows (the actual runs) plus the synthesized deciding
    // row: demotion never overwrites a run's own verdict.
    const reviews = await readReviewsById(draft.id);

    expect(reviews).toHaveLength(4);
    expect(reviews.slice(0, 3).map((row) => row.verdict)).toEqual([
      "approve",
      "reject",
      "manual_review",
    ]);
    const deciding = reviews[reviews.length - 1]!;

    expect(deciding.verdict).toBe("manual_review");
    expect(deciding.reasons[0]).toContain("runs disagreed");
    expect((await readJob(job.id)).reviewId).toBe(deciding.id);
    expect((await readDraft(draft.id)).status).toBe("changes_requested");
  });

  it("makes one plain call when the knob disables corroboration", async () => {
    process.env.POPCHARTS_DRAFT_REVIEW_CORROBORATION = "false";
    const { draft } = await seedDraftAndJob();
    const dependency = scriptedReview([
      async () => makeReviewResult({ provider: "ollama", verdict: "approve" }),
    ]);
    await processDraftReviewJobsOnce({}, dependency);

    expect(dependency.calls()).toBe(1);
    expect(await readReviews(draft.id)).toHaveLength(1);
    expect((await readDraft(draft.id)).status).toBe("approved");
  });

  it("fails the attempt with no rows when run 2 throws", async () => {
    const { draft, job } = await seedDraftAndJob();
    const dependency = scriptedReview([
      async () => makeReviewResult({ provider: "ollama", verdict: "approve" }),
      async () => {
        throw new Error("provider exploded on rerun");
      },
    ]);
    const outcomes = await processDraftReviewJobsOnce({}, dependency);

    expect(outcomes).toEqual([
      { draftId: draft.id, jobId: job.id, outcome: "failed" },
    ]);

    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("retryable_failed");
    expect(jobRow.lastError).toBe("provider exploded on rerun");

    // Run 1's approve must not survive a failed corroboration: no review
    // rows, and the draft stays locked in review awaiting the retry.
    expect(await readReviews(draft.id)).toHaveLength(0);
    expect((await readDraft(draft.id)).status).toBe("in_review");
  });

  it("drops the outcome when the lease is stolen mid-corroboration", async () => {
    const { draft, job } = await seedDraftAndJob();
    const dependency = scriptedReview([
      async () => {
        // Another runner reclaims the job while run 1 is in flight; the
        // pre-run-2 lease renewal must then abandon this runner's work.
        await dbc
          .update(schema.marketDraftReviewJobs)
          .set({ lockedBy: "thief" })
          .where(eq(schema.marketDraftReviewJobs.id, job.id));
        return makeReviewResult({ provider: "ollama", verdict: "approve" });
      },
    ]);
    const outcomes = await processDraftReviewJobsOnce({}, dependency);

    expect(outcomes).toEqual([
      { draftId: draft.id, jobId: job.id, outcome: "failed" },
    ]);
    expect(dependency.calls()).toBe(1);

    // The fenced failure update matches nothing, so the thief's claim is
    // untouched and nothing was persisted by this runner.
    const jobRow = await readJob(job.id);

    expect(jobRow.status).toBe("running");
    expect(jobRow.lockedBy).toBe("thief");
    expect(await readReviews(draft.id)).toHaveLength(0);
    expect((await readDraft(draft.id)).status).toBe("in_review");
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
