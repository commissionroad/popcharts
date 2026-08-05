// Real-SQL tier for the published-market review join. This query is the only
// thing standing between a published market and an empty review section (ADR
// 0022 P5 left `market_ai_reviews` unwritten), and everything it has to get
// right is invisible to a mocked test: the drafts join, the chain-scoped key,
// the narrowing to the published snapshot, and the newest-first pick among
// repeat reviews of that same snapshot.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import type { ReviewScoreRationales, ReviewScores } from "src/ai-review/types";
import type { db as productionDb } from "src/db/client";
import { setDbForTesting } from "src/db/client";
import * as schema from "src/db/schema";
import type { DraftReviewFeedback } from "src/db/schema/market-draft-reviews";
import { createPgliteDb } from "src/test-support/pglite-db";

import { latestReviewsForPublishedMarkets } from "./market-drafts";

const CHAIN_ID = 31337;
const OTHER_CHAIN_ID = 8453;
const MARKET_ID = 7n;
const PUBLISHED_HASH = `0x${"22".repeat(32)}`;
const EARLIER_HASH = `0x${"11".repeat(32)}`;

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

const FEEDBACK: DraftReviewFeedback = {
  items: [],
  summary: "Looks good.",
};

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

// One PGlite per file, emptied between tests: an instance costs ~1.2-2GB
// resident that close() does not hand back, so one per test exhausts the
// allocator.
beforeEach(async () => {
  await resetDb();
});

async function insertDraft({
  publishedChainId = CHAIN_ID,
  publishedMarketId = MARKET_ID,
  submittedMetadataHash = PUBLISHED_HASH,
}: {
  publishedChainId?: number | null;
  publishedMarketId?: bigint | null;
  submittedMetadataHash?: string | null;
} = {}) {
  const [draft] = await dbc
    .insert(schema.marketDrafts)
    .values({
      ownerUserId: "owner-1",
      publishedChainId,
      publishedMarketId,
      question: "Will the index close above 5000?",
      status: "published",
      submittedMetadataHash,
    })
    .returning({ id: schema.marketDrafts.id });

  return draft!.id;
}

async function insertReview({
  draftId,
  metadataHash = PUBLISHED_HASH,
  reviewedAt,
  verdict = "approve",
}: {
  draftId: number;
  metadataHash?: string;
  reviewedAt: Date;
  verdict?: "approve" | "manual_review" | "reject";
}) {
  const [review] = await dbc
    .insert(schema.marketDraftReviews)
    .values({
      draftId,
      evidence: [],
      feedback: FEEDBACK,
      hardFlags: [],
      metadataHash,
      promptVersion: "v1",
      provider: "heuristic",
      reasons: [],
      reviewedAt,
      scoreRationales: RATIONALES,
      scores: SCORES,
      sourceChecks: [],
      verdict,
    })
    .returning({ id: schema.marketDraftReviews.id });

  return review!.id;
}

describe("latestReviewsForPublishedMarkets", () => {
  it("resolves a published market to the review of its published snapshot", async () => {
    const draftId = await insertDraft();
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const rows = await latestReviewsForPublishedMarkets({
      chainIds: [CHAIN_ID],
      marketIds: [MARKET_ID],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.chainId).toBe(CHAIN_ID);
    expect(rows[0]!.marketId).toBe(MARKET_ID);
    expect(rows[0]!.review.scores).toEqual(SCORES);
    expect(rows[0]!.review.scoreRationales).toEqual(RATIONALES);
  });

  it("ignores reviews of snapshots the draft has since edited past", async () => {
    const draftId = await insertDraft();
    // Reviewed later in wall-clock time, but against superseded content: a
    // plain newest-first pick without the hash filter would return this one.
    await insertReview({
      draftId,
      metadataHash: EARLIER_HASH,
      reviewedAt: new Date("2026-08-09T00:00:00Z"),
      verdict: "reject",
    });
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const rows = await latestReviewsForPublishedMarkets({
      chainIds: [CHAIN_ID],
      marketIds: [MARKET_ID],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.review.verdict).toBe("approve");
  });

  it("collapses a re-reviewed snapshot to its newest verdict", async () => {
    const draftId = await insertDraft();
    // "Resubmit as is" re-reviews identical content, so a single published
    // snapshot legitimately carries more than one review row.
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
      verdict: "manual_review",
    });
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-05T00:00:00Z"),
    });

    const rows = await latestReviewsForPublishedMarkets({
      chainIds: [CHAIN_ID],
      marketIds: [MARKET_ID],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.review.verdict).toBe("approve");
  });

  it("does not match a market id published on a different chain", async () => {
    const draftId = await insertDraft({ publishedChainId: OTHER_CHAIN_ID });
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const rows = await latestReviewsForPublishedMarkets({
      chainIds: [CHAIN_ID],
      marketIds: [MARKET_ID],
    });

    expect(rows).toEqual([]);
  });

  it("skips drafts that were never published", async () => {
    const draftId = await insertDraft({
      publishedChainId: null,
      publishedMarketId: null,
    });
    await insertReview({
      draftId,
      reviewedAt: new Date("2026-08-01T00:00:00Z"),
    });

    const rows = await latestReviewsForPublishedMarkets({
      chainIds: [CHAIN_ID],
      marketIds: [MARKET_ID],
    });

    expect(rows).toEqual([]);
  });

  it("issues no query for an empty market page", async () => {
    await expect(
      latestReviewsForPublishedMarkets({ chainIds: [], marketIds: [] }),
    ).resolves.toEqual([]);
  });
});
