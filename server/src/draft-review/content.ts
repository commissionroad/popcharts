import { keccak256, stringToBytes } from "viem";

import {
  serializeMarketMetadata,
  type MarketMetadata,
} from "@popcharts/protocol";

import type { MarketReviewMetadata } from "src/ai-review/types";
import type { MarketDraftRow } from "src/db/schema/market-drafts";

/** Bounds shared with the app's create form; a draft outside them cannot submit. */
export const DRAFT_LIMITS = {
  maxLiquidityParameter: 10_000,
  maxOutcomeLabelLength: 40,
  /** Two years — past this a "prediction" is a time capsule. */
  maxResolutionWindowSeconds: 2 * 365 * 24 * 60 * 60,
  maxOpeningProbability: 98,
  minGraduationWindowSeconds: 5 * 60,
  minLiquidityParameter: 500,
  minOpeningProbability: 2,
} as const;

/** Field-keyed validation errors for a draft submission. */
export type DraftValidationErrors = Partial<
  Record<
    | "category"
    | "graduationWindowSeconds"
    | "liquidityParameter"
    | "openingProbability"
    | "outcomeNo"
    | "outcomeYes"
    | "question"
    | "resolutionCriteria"
    | "resolutionWindowSeconds",
    string
  >
>;

/**
 * Server-side gate for submitting a draft to review: the same required-field
 * and bounds rules the create form enforces, re-checked here because the form
 * is not the only writer (clones and API callers are too).
 */
export function validateDraftForSubmission(
  draft: MarketDraftRow,
): DraftValidationErrors {
  const errors: DraftValidationErrors = {};

  if (!draft.question.trim()) {
    errors.question = "Add a market question.";
  }

  if (!draft.category.trim()) {
    errors.category = "Choose a category.";
  }

  if (!draft.resolutionCriteria.trim()) {
    errors.resolutionCriteria = "Add resolution criteria.";
  }

  if (draft.outcomeYes.trim().length > DRAFT_LIMITS.maxOutcomeLabelLength) {
    errors.outcomeYes = `Keep the YES label under ${DRAFT_LIMITS.maxOutcomeLabelLength} characters.`;
  }

  if (draft.outcomeNo.trim().length > DRAFT_LIMITS.maxOutcomeLabelLength) {
    errors.outcomeNo = `Keep the NO label under ${DRAFT_LIMITS.maxOutcomeLabelLength} characters.`;
  }

  if (
    !Number.isInteger(draft.openingProbability) ||
    draft.openingProbability < DRAFT_LIMITS.minOpeningProbability ||
    draft.openingProbability > DRAFT_LIMITS.maxOpeningProbability
  ) {
    errors.openingProbability =
      "Choose an opening YES probability from 2% to 98%.";
  }

  if (
    !Number.isInteger(draft.liquidityParameter) ||
    draft.liquidityParameter < DRAFT_LIMITS.minLiquidityParameter ||
    draft.liquidityParameter > DRAFT_LIMITS.maxLiquidityParameter
  ) {
    errors.liquidityParameter = "Choose b from 500 to 10,000.";
  }

  if (draft.graduationWindowSeconds < DRAFT_LIMITS.minGraduationWindowSeconds) {
    errors.graduationWindowSeconds =
      "Give the market at least five minutes to graduate.";
  }

  if (draft.resolutionWindowSeconds <= draft.graduationWindowSeconds) {
    errors.resolutionWindowSeconds =
      "Resolution must come after the graduation deadline.";
  }

  if (draft.resolutionWindowSeconds > DRAFT_LIMITS.maxResolutionWindowSeconds) {
    errors.resolutionWindowSeconds =
      "Keep the resolution deadline within two years.";
  }

  return errors;
}

/**
 * Splits the free-text sources field into individual entries: one per line or
 * comma-separated. URLs are kept whole; a bare "CNN / BBC" style entry splits
 * on slashes, matching the create form's parser so a draft round-trips to the
 * same source list the creator previewed.
 */
export function parseDraftResolutionSources(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .flatMap((source) =>
      source.includes("://") ? [source] : source.split("/"),
    )
    .map((source) => source.trim())
    .filter(Boolean);
}

/**
 * The canonical metadata payload a draft would publish: the object, its exact
 * serialized bytes, and the keccak256 hash those bytes commit to. This hash is
 * the draft's content snapshot — reviews are keyed to it, and publish refuses
 * when the live content no longer matches the reviewed hash.
 */
export function buildDraftMetadata(draft: MarketDraftRow): {
  metadata: MarketMetadata;
  metadataHash: `0x${string}`;
  metadataPayload: string;
} {
  const outcomeYes = draft.outcomeYes.trim();
  const outcomeNo = draft.outcomeNo.trim();
  const resolutionSources = parseDraftResolutionSources(
    draft.resolutionSources || draft.resolutionUrl,
  );
  const resolutionUrl = draft.resolutionUrl.trim();
  const metadata: MarketMetadata = {
    category: draft.category,
    createdAt: draft.createdAt.toISOString(),
    description: draft.description.trim(),
    question: draft.question.trim(),
    resolutionCriteria: draft.resolutionCriteria.trim(),
    version: 1,
    ...(outcomeYes ? { outcomeYes } : {}),
    ...(outcomeNo ? { outcomeNo } : {}),
    ...(resolutionSources.length > 0 ? { resolutionSources } : {}),
    ...(resolutionUrl ? { resolutionUrl } : {}),
  };
  const metadataPayload = serializeMarketMetadata(metadata);

  return {
    metadata,
    metadataHash: keccak256(stringToBytes(metadataPayload)),
    metadataPayload,
  };
}

/** The reviewer-facing view of a draft's content, for the AI review pipeline. */
export function buildDraftReviewMetadata(
  draft: MarketDraftRow,
  metadataHash: string,
): MarketReviewMetadata {
  const { metadata } = buildDraftMetadata(draft);

  return {
    category: metadata.category,
    createdAt: metadata.createdAt,
    description: metadata.description,
    metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    ...(metadata.resolutionSources
      ? { resolutionSources: metadata.resolutionSources }
      : {}),
    ...(metadata.resolutionUrl
      ? { resolutionUrl: metadata.resolutionUrl }
      : {}),
  };
}
