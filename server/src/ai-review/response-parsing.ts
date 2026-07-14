import type { normalizeScores } from "./scoring";
import type {
  EvidenceItem,
  ReviewScoreRationales,
  ReviewScores,
  SourceCheck,
} from "./types";

/**
 * Untrusted-model-output parsing shared by every review provider. This is a
 * security control: model output is never trusted, so scores are clamped,
 * unrecognized verdicts fall back to manual_review, and sourceChecks that are
 * not backed by collected evidence are discarded. Keep exactly one
 * implementation of these rules.
 */

export type RawModelReview = {
  hardFlags?: unknown;
  reasons?: unknown;
  scoreRationales?: unknown;
  scores?: unknown;
  sourceChecks?: unknown;
  verdict?: unknown;
};

const SCORE_KEYS = [
  "contentSafety",
  "corroboration",
  "disputeRisk",
  "objectivity",
  "promptInjectionRisk",
  "publicKnowability",
  "sourceQuality",
] as const satisfies readonly (keyof ReviewScores)[];

export function parseScoreRationales(value: unknown): ReviewScoreRationales {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    SCORE_KEYS.map((key) => {
      const rationale = record[key];
      return [
        key,
        typeof rationale === "string" && rationale.trim()
          ? rationale.trim().slice(0, 500)
          : "The reviewer did not provide a rationale for this score.",
      ];
    }),
  ) as ReviewScoreRationales;
}

/**
 * Parses the model's JSON reply, tolerating surrounding prose or markdown by
 * falling back to the outermost braced block. `providerLabel` names the
 * provider in the failure message (e.g. "Anthropic did not return JSON.").
 */
export function parseModelReview(
  content: string,
  providerLabel: string,
): RawModelReview {
  try {
    return JSON.parse(content) as RawModelReview;
  } catch {
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new Error(`${providerLabel} did not return JSON.`);
    }

    return JSON.parse(json) as RawModelReview;
  }
}

export function parseVerdict(value: unknown) {
  return value === "approve" || value === "reject" || value === "manual_review"
    ? value
    : "manual_review";
}

export function parseSourceChecks(value: unknown): SourceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url : "";
      const domain = typeof record.domain === "string" ? record.domain : "";
      const notes = typeof record.notes === "string" ? record.notes : "";

      if (!url || !domain) {
        return null;
      }

      return {
        domain,
        notes,
        relevant: record.relevant === true,
        sourceTier: parseSourceTier(record.sourceTier),
        url,
      } satisfies SourceCheck;
    })
    .filter((item): item is SourceCheck => item !== null);
}

/**
 * Drops sourceChecks that do not reference collected evidence, so the model
 * cannot invent sources; with no evidence at all, no sourceChecks survive.
 */
export function filterSourceChecksByEvidence(
  sourceChecks: SourceCheck[],
  evidence: EvidenceItem[],
) {
  if (evidence.length === 0) {
    return [];
  }

  const evidenceUrls = new Set(evidence.map((item) => item.url));
  const evidenceDomains = new Set(evidence.map((item) => item.domain));

  return sourceChecks.filter(
    (sourceCheck) =>
      evidenceUrls.has(sourceCheck.url) ||
      evidenceDomains.has(sourceCheck.domain),
  );
}

/**
 * Caps evidence-dependent scores when no sourceChecks survived filtering, and
 * caps promptInjectionRisk unless a prompt-injection hard flag corroborates
 * the model's own assessment.
 */
export function adjustModelScoresForEvidence(
  scores: ReturnType<typeof normalizeScores>,
  sourceChecks: SourceCheck[],
  hardFlags: string[],
) {
  const hasPromptInjectionFlag = hardFlags.some((flag) =>
    flag.includes("prompt_injection"),
  );
  const promptInjectionRisk = hasPromptInjectionFlag
    ? scores.promptInjectionRisk
    : Math.min(scores.promptInjectionRisk, 2);

  if (sourceChecks.length === 0) {
    return {
      ...scores,
      corroboration: Math.min(scores.corroboration, 1),
      promptInjectionRisk,
      sourceQuality: Math.min(scores.sourceQuality, 1),
    };
  }

  return { ...scores, promptInjectionRisk };
}

/**
 * Keeps displayed rationales aligned with the final, safety-normalized scores
 * rather than presenting the model's raw explanation beside a capped number.
 */
export function alignScoreRationalesWithAdjustedScores({
  adjustedScores,
  sourceChecks,
  rawScores,
  rationales,
}: {
  adjustedScores: ReviewScores;
  sourceChecks: SourceCheck[];
  rawScores: ReviewScores;
  rationales: ReviewScoreRationales;
}): ReviewScoreRationales {
  return {
    ...rationales,
    corroboration:
      sourceChecks.length === 0
        ? "No source check matched the collected evidence, so independent corroboration could not be credited."
        : rationales.corroboration,
    promptInjectionRisk:
      adjustedScores.promptInjectionRisk < rawScores.promptInjectionRisk
        ? appendNormalizationNote(
            rationales.promptInjectionRisk,
            "The final score was capped because no prompt-injection hard flag corroborated the risk.",
          )
        : rationales.promptInjectionRisk,
    sourceQuality:
      sourceChecks.length === 0
        ? "No source check matched the collected evidence, so source quality could not be credited."
        : rationales.sourceQuality,
  };
}

function appendNormalizationNote(rationale: string, note: string) {
  return `${rationale} ${note}`.slice(0, 500);
}

export function parseSourceTier(value: unknown) {
  if (
    value === "primary" ||
    value === "major_news" ||
    value === "specialist" ||
    value === "ugc" ||
    value === "suspicious" ||
    value === "unreachable" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

export function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function unique(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}
