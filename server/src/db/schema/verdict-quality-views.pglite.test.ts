// Real-SQL cover for the ADR 0027 A4 quality views. Every claim these views
// make is a Postgres aggregate — `filter (where ...)`, `date_trunc`, the
// clamped `floor()` bucket, `avg()` skipping nulls — so a mocked test would
// assert nothing about them. The views also have no other consumer yet, which
// makes this file the only thing that would notice if the generated DDL
// stopped matching the schema module.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { asc } from "drizzle-orm";

import type { ReviewScoreRationales, ReviewScores } from "src/ai-review/types";
import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import type { DraftReviewFeedback } from "src/db/schema/market-draft-reviews";
import { createPgliteDb } from "src/test-support/pglite-db";
import {
  resolutionRowValues,
  seedResolutionMarket,
} from "src/test-support/resolution-fixtures";

const DAY_ONE = "2026-08-01";
const DAY_TWO = "2026-08-02";

/** Mid-morning on the given day, so a UTC day bucket is unambiguous. */
function at(day: string): Date {
  return new Date(`${day}T10:00:00.000Z`);
}

const SCORES: ReviewScores = {
  contentSafety: 5,
  corroboration: 4,
  disputeRisk: 1,
  objectivity: 4,
  promptInjectionRisk: 0,
  publicKnowability: 5,
  sourceQuality: 3,
};

const RATIONALES: ReviewScoreRationales = {
  contentSafety: "Nothing unsafe.",
  corroboration: "Two independent sources.",
  disputeRisk: "Wording leaves little room to argue.",
  objectivity: "Resolves on a published number.",
  promptInjectionRisk: "No instruction-like text.",
  publicKnowability: "The result is public.",
  sourceQuality: "One primary, one major-news.",
};

const FEEDBACK: DraftReviewFeedback = { items: [], summary: "Looks good." };

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One PGlite per file, emptied between tests: an instance costs ~1.2-2GB
// resident that close() does not hand back.
beforeEach(async () => {
  await resetDb();
  await seedResolutionMarket(dbc);
});

async function insertResolutions(
  rows: Partial<typeof schema.marketResolutions.$inferInsert>[],
) {
  await dbc
    .insert(schema.marketResolutions)
    .values(rows.map((row) => resolutionRowValues(row)));
}

async function insertDraftReviews(
  rows: Partial<typeof schema.marketDraftReviews.$inferInsert>[],
) {
  const [draft] = await dbc
    .insert(schema.marketDrafts)
    .values({
      ownerUserId: "owner-1",
      publicId: "k3f9x2mq7rt4wbnz",
      question: "Will the index close above 5000?",
    })
    .returning({ id: schema.marketDrafts.id });

  await dbc.insert(schema.marketDraftReviews).values(
    rows.map((row) => ({
      draftId: draft!.id,
      evidence: [],
      feedback: FEEDBACK,
      hardFlags: [],
      metadataHash: `0x${"22".repeat(32)}`,
      promptVersion: "v1",
      provider: "heuristic" as const,
      reasons: [],
      scoreRationales: RATIONALES,
      scores: SCORES,
      sourceChecks: [],
      verdict: "approve" as const,
      ...row,
    })),
  );
}

describe("verdict_quality_resolution_daily", () => {
  it("reports the parked rate per day, provider, and prompt version", async () => {
    await insertResolutions([
      { createdAt: at(DAY_ONE), verdict: "resolve_yes" },
      { createdAt: at(DAY_ONE), verdict: "resolve_no", outcome: "no" },
      {
        createdAt: at(DAY_ONE),
        outcome: "abstain",
        verdict: "manual_review",
      },
      { createdAt: at(DAY_TWO), verdict: "resolve_yes" },
    ]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityResolutionDaily)
      .orderBy(asc(schema.verdictQualityResolutionDaily.day));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      day: DAY_ONE,
      manualReviewRuns: 1,
      manualReviewRate: 1 / 3,
      promptVersion: "v1",
      provider: "anthropic",
      resolveNoRuns: 1,
      resolveYesRuns: 1,
      runs: 3,
    });
    expect(rows[1]).toMatchObject({
      day: DAY_TWO,
      manualReviewRate: 0,
      manualReviewRuns: 0,
      runs: 1,
    });
  });

  it("splits providers and commit states rather than pooling them", async () => {
    await insertResolutions([
      { createdAt: at(DAY_ONE), provider: "anthropic" },
      { createdAt: at(DAY_ONE), provider: "ollama" },
      // ADR 0026: a pending row is not a real resolution. The view must let a
      // reader see that, which it cannot do if pending rows are pooled in.
      { commitState: "pending", createdAt: at(DAY_ONE), provider: "anthropic" },
    ]);

    const rows = await dbc.select().from(schema.verdictQualityResolutionDaily);

    expect(rows).toHaveLength(3);
    expect(
      rows.filter(
        (row) =>
          row.provider === "anthropic" && row.commitState === "confirmed",
      ),
    ).toHaveLength(1);
    expect(rows.filter((row) => row.commitState === "pending")).toHaveLength(1);
  });

  it("counts a run as hard-flagged only when it carries a flag", async () => {
    await insertResolutions([
      { createdAt: at(DAY_ONE), hardFlags: ["prompt_injection"] },
      { createdAt: at(DAY_ONE), hardFlags: [] },
    ]);

    const [row] = await dbc.select().from(schema.verdictQualityResolutionDaily);

    expect(row).toMatchObject({ hardFlaggedRuns: 1, runs: 2 });
  });

  it("leaves avg_confidence null when a group reports no confidence", async () => {
    await insertResolutions([
      { confidence: null, createdAt: at(DAY_ONE), provider: "manual" },
      { confidence: 0.6, createdAt: at(DAY_ONE), provider: "anthropic" },
      { confidence: 0.8, createdAt: at(DAY_ONE), provider: "anthropic" },
    ]);

    const rows = await dbc.select().from(schema.verdictQualityResolutionDaily);
    const manual = rows.find((row) => row.provider === "manual");
    const model = rows.find((row) => row.provider === "anthropic");

    // Null, not zero: an operator override has no confidence to report, and
    // averaging it as zero would understate the model's calibration.
    expect(manual?.avgConfidence).toBeNull();
    expect(model?.avgConfidence).toBeCloseTo(0.7, 5);
  });
});

describe("verdict_quality_resolution_confidence", () => {
  it("buckets confidence into ten half-open tenths", async () => {
    await insertResolutions([
      { confidence: 0.0 },
      { confidence: 0.04 },
      { confidence: 0.1 },
      { confidence: 0.55 },
    ]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityResolutionConfidence)
      .orderBy(asc(schema.verdictQualityResolutionConfidence.bucketLower));

    expect(
      rows.map((row) => [row.bucketLower, row.runs] as const),
    ).toStrictEqual([
      [0, 2],
      [0.1, 1],
      [0.5, 1],
    ]);
  });

  it("folds a confidence of exactly 1.0 into the top bucket", async () => {
    await insertResolutions([{ confidence: 1 }, { confidence: 0.95 }]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityResolutionConfidence);

    // Not an eleventh bucket at 1.0 holding a single run.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucketLower: 0.9, runs: 2 });
  });

  it("buckets an edge confidence by its decimal value, not its float4 value", async () => {
    // The trap this pins: `confidence` is `real`, so a stored 0.7 is really
    // 0.69999998 and `floor(0.7 * 10)` in float4 is 6. Without the numeric
    // cast in the view, every one of these lands one bucket too low, and the
    // histogram misreports calibration without erroring.
    await insertResolutions([
      { confidence: 0.3 },
      { confidence: 0.7 },
      { confidence: 0.9 },
    ]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityResolutionConfidence)
      .orderBy(asc(schema.verdictQualityResolutionConfidence.bucketLower));

    expect(rows.map((row) => row.bucketLower)).toStrictEqual([0.3, 0.7, 0.9]);
  });

  it("excludes rows with no confidence instead of bucketing them at zero", async () => {
    await insertResolutions([
      { confidence: null, provider: "manual" },
      { confidence: 0.7 },
    ]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityResolutionConfidence);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucketLower: 0.7, provider: "anthropic" });
  });
});

describe("verdict_quality_draft_review_daily", () => {
  it("reports the review verdict mix per day", async () => {
    await insertDraftReviews([
      { reviewedAt: at(DAY_ONE), verdict: "approve" },
      { reviewedAt: at(DAY_ONE), verdict: "reject" },
      { reviewedAt: at(DAY_ONE), verdict: "manual_review" },
      {
        hardFlags: ["prompt_injection"],
        reviewedAt: at(DAY_ONE),
        verdict: "reject",
      },
      { reviewedAt: at(DAY_TWO), verdict: "approve" },
    ]);

    const rows = await dbc
      .select()
      .from(schema.verdictQualityDraftReviewDaily)
      .orderBy(asc(schema.verdictQualityDraftReviewDaily.day));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      approveReviews: 1,
      day: DAY_ONE,
      hardFlaggedReviews: 1,
      manualReviewRate: 0.25,
      manualReviewReviews: 1,
      provider: "heuristic",
      rejectReviews: 2,
      reviews: 4,
    });
    expect(rows[1]).toMatchObject({ day: DAY_TWO, reviews: 1 });
  });

  it("groups by prompt version, so an iteration does not average into the last one", async () => {
    await insertDraftReviews([
      { promptVersion: "v1", reviewedAt: at(DAY_ONE), verdict: "approve" },
      { promptVersion: "v2", reviewedAt: at(DAY_ONE), verdict: "reject" },
    ]);

    const rows = await dbc.select().from(schema.verdictQualityDraftReviewDaily);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.promptVersion).sort()).toStrictEqual([
      "v1",
      "v2",
    ]);
  });
});
