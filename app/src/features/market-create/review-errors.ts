import type {
  CreateMarketDraftField,
  CreateMarketValidationErrors,
} from "@/domain/market-creation/types";

const REVIEW_ERROR_FIELD_ORDER: ReadonlyArray<CreateMarketDraftField> = [
  "question",
  "category",
  "resolutionCriteria",
  "resolutionSources",
  "openingProbability",
  "graduationTime",
  "resolutionTime",
  "liquidityParameter",
  "graduationThreshold",
];

const REVIEW_ERROR_TARGET_IDS: Partial<Record<CreateMarketDraftField, string>> = {
  graduationTime: "graduation-time",
  openingProbability: "opening-probability",
  question: "question",
  resolutionCriteria: "resolution-criteria",
  resolutionSources: "resolution-sources",
  resolutionTime: "resolution-time",
  resolutionUrl: "resolution-sources",
};

/**
 * Counts how many draft fields currently fail validation, for the "fix N
 * fields to review" prompt.
 */
export function countErrors(errors: CreateMarketValidationErrors) {
  return Object.keys(errors).length;
}

/**
 * Scrolls to and focuses the form control for the first invalid field, in the
 * top-to-bottom order the form renders. No-op when every erroring field lacks
 * a focusable control.
 */
export function focusFirstReviewError(errors: CreateMarketValidationErrors) {
  const targetId = REVIEW_ERROR_FIELD_ORDER.map((field) =>
    errors[field] ? REVIEW_ERROR_TARGET_IDS[field] : undefined
  ).find(Boolean);

  if (!targetId) {
    return;
  }

  window.requestAnimationFrame(() => {
    const target = document.getElementById(targetId);

    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  });
}

/**
 * Keeps only the deadline errors from a validation result. Deadlines can turn
 * invalid just by time passing, so they surface live while other errors wait
 * until the creator asks to review.
 */
export function getLiveDeadlineErrors(
  validationErrors: CreateMarketValidationErrors
): CreateMarketValidationErrors {
  const liveErrors: CreateMarketValidationErrors = {};

  if (validationErrors.graduationTime) {
    liveErrors.graduationTime = validationErrors.graduationTime;
  }

  if (validationErrors.resolutionTime) {
    liveErrors.resolutionTime = validationErrors.resolutionTime;
  }

  return liveErrors;
}
