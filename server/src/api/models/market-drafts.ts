import { t } from "elysia";

import { DRAFT_FEEDBACK_SEVERITIES } from "src/db/schema/market-draft-reviews";
import { MARKET_DRAFT_STATUSES } from "src/db/schema/market-drafts";
import { literalUnion } from "src/shared/typebox-literals";

import {
  AiReviewProviderSchema,
  AiReviewScoreRationalesSchema,
  AiReviewScoresSchema,
  AiReviewVerdictSchema,
} from "./markets";

/**
 * Market-draft API schemas (ADR 0022). Every schema carries an `$id` matching
 * its registered model name so the OpenAPI spec exposes named components and
 * the generated client gets stable model names — same convention as
 * `src/api/models/markets.ts`.
 */

/** Lifecycle state of an off-chain market draft. */
export const MarketDraftStatusSchema = literalUnion(MARKET_DRAFT_STATUSES, {
  $id: "MarketDraftStatus",
});

/** Severity of a single review feedback item. */
export const DraftFeedbackSeveritySchema = literalUnion(
  DRAFT_FEEDBACK_SEVERITIES,
  { $id: "DraftFeedbackSeverity" },
);

/** The draft form field a feedback item concerns, when one applies. */
export const DraftFeedbackFieldSchema = literalUnion(
  [
    "question",
    "description",
    "resolutionCriteria",
    "resolutionSources",
  ] as const,
  { $id: "DraftFeedbackField" },
);

/** One actionable piece of review feedback: the issue and how to fix it. */
export const DraftFeedbackItemSchema = t.Object(
  {
    field: t.Optional(t.Ref(DraftFeedbackFieldSchema)),
    howToFix: t.String(),
    issue: t.String(),
    severity: t.Ref(DraftFeedbackSeveritySchema),
    title: t.String(),
  },
  { $id: "DraftFeedbackItem" },
);

/** Creator-facing translation of a review: summary plus actionable items. */
export const DraftReviewFeedbackSchema = t.Object(
  {
    items: t.Array(t.Ref(DraftFeedbackItemSchema)),
    summary: t.String(),
  },
  { $id: "DraftReviewFeedback" },
);

/** One completed review of a draft content snapshot. */
export const MarketDraftReviewSchema = t.Object(
  {
    feedback: t.Ref(DraftReviewFeedbackSchema),
    id: t.Number(),
    metadataHash: t.String(),
    modelId: t.Union([t.String(), t.Null()]),
    provider: t.Ref(AiReviewProviderSchema),
    reasons: t.Array(t.String()),
    reviewedAt: t.String(),
    scoreRationales: t.Ref(AiReviewScoreRationalesSchema),
    scores: t.Ref(AiReviewScoresSchema),
    verdict: t.Ref(AiReviewVerdictSchema),
  },
  { $id: "MarketDraftReview" },
);

/** An off-chain market draft with its latest review, as the API returns it. */
export const MarketDraftSchema = t.Object(
  {
    category: t.String(),
    createdAt: t.String(),
    description: t.String(),
    graduationWindowSeconds: t.Number(),
    id: t.Number(),
    intendedCreatorAddress: t.Union([t.String(), t.Null()]),
    isTemplate: t.Boolean(),
    // Optional-omit rather than nullable: orval drops the null arm on $ref
    // unions, so the generated client type would silently lose the "absent"
    // case (same convention as Market.aiReview).
    latestReview: t.Optional(t.Ref(MarketDraftReviewSchema)),
    liquidityParameter: t.Number(),
    openingProbability: t.Number(),
    outcomeNo: t.String(),
    outcomeYes: t.String(),
    publishedAt: t.Union([t.String(), t.Null()]),
    publishedChainId: t.Union([t.Number(), t.Null()]),
    publishedMarketId: t.Union([t.String(), t.Null()]),
    publishedTransactionHash: t.Union([t.String(), t.Null()]),
    question: t.String(),
    resolutionCriteria: t.String(),
    resolutionSources: t.String(),
    resolutionUrl: t.String(),
    resolutionWindowSeconds: t.Number(),
    reviewedAt: t.Union([t.String(), t.Null()]),
    status: t.Ref(MarketDraftStatusSchema),
    submittedAt: t.Union([t.String(), t.Null()]),
    updatedAt: t.String(),
  },
  { $id: "MarketDraft" },
);

/** The owner's drafts, most recently touched first. */
export const MarketDraftListSchema = t.Array(t.Ref(MarketDraftSchema), {
  $id: "MarketDraftList",
});

/** Writable draft content for create and update. */
export const MarketDraftWriteSchema = t.Object(
  {
    category: t.Optional(t.String({ maxLength: 40 })),
    description: t.Optional(t.String({ maxLength: 10_000 })),
    graduationWindowSeconds: t.Optional(
      t.Number({ minimum: 1, multipleOf: 1 }),
    ),
    intendedCreatorAddress: t.Optional(t.Union([t.String(), t.Null()])),
    isTemplate: t.Optional(t.Boolean()),
    liquidityParameter: t.Optional(t.Number({ minimum: 1, multipleOf: 1 })),
    openingProbability: t.Optional(
      t.Number({ maximum: 100, minimum: 0, multipleOf: 1 }),
    ),
    outcomeNo: t.Optional(t.String({ maxLength: 200 })),
    outcomeYes: t.Optional(t.String({ maxLength: 200 })),
    question: t.Optional(t.String({ maxLength: 500 })),
    resolutionCriteria: t.Optional(t.String({ maxLength: 10_000 })),
    resolutionSources: t.Optional(t.String({ maxLength: 5_000 })),
    resolutionUrl: t.Optional(t.String({ maxLength: 2_000 })),
    resolutionWindowSeconds: t.Optional(
      t.Number({ minimum: 1, multipleOf: 1 }),
    ),
  },
  { $id: "MarketDraftWrite" },
);

/** Clone request: from one of the owner's drafts, or any market by id. */
export const MarketDraftCloneRequestSchema = t.Object(
  {
    asTemplate: t.Optional(t.Boolean()),
    fromDraftId: t.Optional(t.Number({ minimum: 1, multipleOf: 1 })),
    fromMarket: t.Optional(
      t.Object({
        chainId: t.Number({ minimum: 1, multipleOf: 1 }),
        marketId: t.String(),
      }),
    ),
  },
  { $id: "MarketDraftCloneRequest" },
);

/** Field-keyed validation errors when a submission is rejected. */
export const MarketDraftValidationErrorsSchema = t.Object(
  {
    errors: t.Object({
      category: t.Optional(t.String()),
      graduationWindowSeconds: t.Optional(t.String()),
      liquidityParameter: t.Optional(t.String()),
      openingProbability: t.Optional(t.String()),
      outcomeNo: t.Optional(t.String()),
      outcomeYes: t.Optional(t.String()),
      question: t.Optional(t.String()),
      resolutionCriteria: t.Optional(t.String()),
      resolutionWindowSeconds: t.Optional(t.String()),
    }),
    message: t.String(),
  },
  { $id: "MarketDraftValidationErrors" },
);

/** Wire-serialized createMarket params, minted at publish time. */
export const MarketDraftPublishParamsSchema = t.Object(
  {
    bypassAiResolution: t.Boolean(),
    graduationDeadline: t.String(),
    graduationThreshold: t.String(),
    liquidityParameter: t.String(),
    metadata: t.String(),
    metadataHash: t.String(),
    openingProbabilityWad: t.String(),
    resolutionTime: t.String(),
    yesNotBefore: t.String(),
  },
  { $id: "MarketDraftPublishParams" },
);

/** Publish confirmation: the market the draft became. */
export const MarketDraftPublishedWriteSchema = t.Object(
  {
    chainId: t.Number({ minimum: 1, multipleOf: 1 }),
    marketId: t.String(),
    transactionHash: t.String(),
  },
  { $id: "MarketDraftPublishedWrite" },
);

/** Result of recording a publish: the linked draft plus bridge outcome. */
export const MarketDraftPublishedSchema = t.Object(
  {
    bridgeApproved: t.Boolean(),
    draft: t.Ref(MarketDraftSchema),
  },
  { $id: "MarketDraftPublished" },
);
