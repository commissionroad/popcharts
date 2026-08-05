import type { MarketDraft, MarketDraftWrite } from "@popcharts/api-client/models";

import {
  dateTimeLocalToDate,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
  toDateTimeLocalValue,
} from "@/domain/market-creation/create-market";
import type {
  CreateMarketDraft,
  GraduationPresetLabel,
  ResolutionPresetLabel,
} from "@/domain/market-creation/types";
import type { MarketCategory } from "@/domain/markets/types";
import { MARKET_CATEGORIES } from "@/domain/markets/types";

/**
 * Server drafts store deadlines as relative windows measured from publish
 * (ADR 0022 §4), while the form edits absolute datetime-local values. These
 * pure mappers translate between the two around a fixed `now`.
 */

const MIN_WINDOW_SECONDS = 60;

/**
 * Windows within this tolerance of the stored value are considered unchanged,
 * so the drift of "deadline minus a moving now" doesn't dirty the autosave
 * loop every second.
 */
export const WINDOW_DRIFT_TOLERANCE_SECONDS = 90;

/** The absolute deadline the form should show for a stored relative window. */
export function windowToDateTimeLocal(windowSeconds: number, now: Date): string {
  return toDateTimeLocalValue(new Date(now.getTime() + windowSeconds * 1000));
}

/** The relative window a form deadline represents, measured from `now`. */
export function dateTimeLocalToWindowSeconds(value: string, now: Date): number {
  const date = dateTimeLocalToDate(value);

  if (!date) {
    return MIN_WINDOW_SECONDS;
  }

  return Math.max(
    Math.round((date.getTime() - now.getTime()) / 1000),
    MIN_WINDOW_SECONDS
  );
}

/** The write payload that persists a form draft's content. */
export function formDraftToWrite(
  draft: CreateMarketDraft,
  now: Date
): MarketDraftWrite {
  return {
    category: draft.category,
    description: draft.description,
    graduationWindowSeconds: dateTimeLocalToWindowSeconds(draft.graduationTime, now),
    liquidityParameter: draft.liquidityParameter,
    openingProbability: draft.openingProbability,
    outcomeNo: draft.outcomeNo,
    outcomeYes: draft.outcomeYes,
    question: draft.question,
    resolutionCriteria: draft.resolutionCriteria,
    resolutionSources: draft.resolutionSources,
    resolutionUrl: draft.resolutionUrl,
    resolutionWindowSeconds: dateTimeLocalToWindowSeconds(draft.resolutionTime, now),
  };
}

/** Rebuilds the form model from a stored draft, anchoring windows at `now`. */
export function serverDraftToFormDraft(
  serverDraft: MarketDraft,
  now: Date
): CreateMarketDraft {
  return {
    bypassAiResolution: false,
    category: toMarketCategory(serverDraft.category),
    createdAt: serverDraft.createdAt,
    description: serverDraft.description,
    graduationPreset: graduationPresetFor(serverDraft.graduationWindowSeconds),
    graduationTime: windowToDateTimeLocal(serverDraft.graduationWindowSeconds, now),
    liquidityParameter: serverDraft.liquidityParameter,
    openingProbability: serverDraft.openingProbability,
    outcomeNo: serverDraft.outcomeNo,
    outcomeYes: serverDraft.outcomeYes,
    question: serverDraft.question,
    resolutionCriteria: serverDraft.resolutionCriteria,
    resolutionSources: serverDraft.resolutionSources,
    resolutionPreset: resolutionPresetFor(serverDraft.resolutionWindowSeconds),
    resolutionTime: windowToDateTimeLocal(serverDraft.resolutionWindowSeconds, now),
    resolutionUrl: serverDraft.resolutionUrl,
  };
}

/**
 * True when the write would change what the server already stores. Window
 * fields compare within a tolerance so a recomputed "deadline minus now"
 * doesn't register as an edit (and window fields inside the tolerance are
 * dropped from the patch by {@link stableWrite}).
 */
export function writeChangesServerDraft(
  write: MarketDraftWrite,
  serverDraft: MarketDraft
): boolean {
  const stable = stableWrite(write, serverDraft);

  return Object.keys(stable).some((key) => {
    const field = key as keyof MarketDraftWrite;

    return stable[field] !== serverDraft[field as keyof MarketDraft];
  });
}

/**
 * The write payload with drift-only window changes removed, so saves carry
 * real edits and nothing else.
 */
export function stableWrite(
  write: MarketDraftWrite,
  serverDraft: MarketDraft | null
): MarketDraftWrite {
  if (!serverDraft) {
    return write;
  }

  const result: MarketDraftWrite = { ...write };

  if (
    write.graduationWindowSeconds !== undefined &&
    Math.abs(write.graduationWindowSeconds - serverDraft.graduationWindowSeconds) <=
      WINDOW_DRIFT_TOLERANCE_SECONDS
  ) {
    delete result.graduationWindowSeconds;
  }

  if (
    write.resolutionWindowSeconds !== undefined &&
    Math.abs(write.resolutionWindowSeconds - serverDraft.resolutionWindowSeconds) <=
      WINDOW_DRIFT_TOLERANCE_SECONDS
  ) {
    delete result.resolutionWindowSeconds;
  }

  return result;
}

function toMarketCategory(value: string): MarketCategory {
  return MARKET_CATEGORIES.includes(value as MarketCategory)
    ? (value as MarketCategory)
    : "Crypto";
}

function graduationPresetFor(windowSeconds: number): GraduationPresetLabel | "custom" {
  const match = GRADUATION_PRESETS.find(
    (preset) =>
      Math.abs(preset.milliseconds / 1000 - windowSeconds) <=
      WINDOW_DRIFT_TOLERANCE_SECONDS
  );

  return match?.label ?? "custom";
}

function resolutionPresetFor(windowSeconds: number): ResolutionPresetLabel | "custom" {
  const match = RESOLUTION_PRESETS.find(
    (preset) =>
      Math.abs(preset.milliseconds / 1000 - windowSeconds) <=
      WINDOW_DRIFT_TOLERANCE_SECONDS
  );

  return match?.label ?? "custom";
}
