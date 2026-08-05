import type {
  DraftFeedbackItem,
  MarketDraft,
  MarketDraftReview,
} from "@popcharts/api-client/models";

/**
 * Fixture builders for market drafts and draft reviews, shared by unit tests
 * and Storybook stories so both render the same realistic shapes.
 */

export function draftFeedbackItemFactory(
  overrides: Partial<DraftFeedbackItem> = {}
): DraftFeedbackItem {
  return {
    field: "question",
    howToFix:
      'Start with "Will", "Is", or "Does", name one subject and one deadline: "Will <subject> <event> by <date>?"',
    issue: "The question doesn't read as a clear yes/no proposition.",
    severity: "warning",
    title: "Phrase it as a yes/no question",
    ...overrides,
  };
}

export function draftReviewFactory(
  overrides: Partial<MarketDraftReview> = {}
): MarketDraftReview {
  return {
    feedback: {
      items: [draftFeedbackItemFactory()],
      summary: "Almost there — fix the flagged issues below and resubmit for review.",
    },
    id: 1,
    metadataHash: `0x${"ab".repeat(32)}`,
    modelId: null,
    provider: "heuristic",
    reasons: ["Question should be phrased as a clear YES/NO market."],
    reviewedAt: "2026-07-30T12:00:00.000Z",
    scoreRationales: {
      contentSafety:
        "Deterministic checks found no language associated with severe harm.",
      corroboration: "Deterministic checks do not establish independent corroboration.",
      disputeRisk: "The deterministic baseline cannot fully assess likely disputes.",
      objectivity: "The question is not phrased as a clear binary proposition.",
      promptInjectionRisk:
        "Deterministic checks found no instructions aimed at manipulating the reviewer.",
      publicKnowability: "The metadata names at least one public resolution source.",
      sourceQuality:
        "A resolution source is present, but deterministic checks do not establish its quality.",
    },
    scores: {
      contentSafety: 5,
      corroboration: 0,
      disputeRisk: 2,
      objectivity: 2,
      promptInjectionRisk: 0,
      publicKnowability: 3,
      sourceQuality: 2,
    },
    verdict: "manual_review",
    ...overrides,
  };
}

export function marketDraftFactory(overrides: Partial<MarketDraft> = {}): MarketDraft {
  return {
    category: "Crypto",
    createdAt: "2026-07-30T10:00:00.000Z",
    description: "Settles on the CoinGecko daily close.",
    graduationWindowSeconds: 6 * 60 * 60,
    id: "12",
    intendedCreatorAddress: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    isTemplate: false,
    liquidityParameter: 5000,
    openingProbability: 55,
    outcomeNo: "",
    outcomeYes: "",
    publishedAt: null,
    publishedChainId: null,
    publishedMarketId: null,
    publishedTransactionHash: null,
    question: "Will bitcoin close above $100k on 2027-01-01?",
    resolutionCriteria:
      "Resolves YES if the BTC/USD daily close on 2027-01-01 exceeds 100000 per CoinGecko.",
    resolutionSources: "https://www.coingecko.com",
    resolutionUrl: "",
    resolutionWindowSeconds: 7 * 24 * 60 * 60,
    reviewedAt: null,
    status: "editing",
    submittedAt: null,
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...overrides,
  };
}
