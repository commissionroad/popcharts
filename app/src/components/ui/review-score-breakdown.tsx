import type { AiReviewScoreRationales, AiReviewScores } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

/**
 * Display order and polarity for the seven reviewer dimensions, defined once
 * for every surface that renders them. Scores run 0-5; for `risk` dimensions a
 * high score is bad, so the tone scale is inverted. A dimension added
 * server-side surfaces here as a type error on {@link AiReviewScores} rather
 * than silently going unrendered on one screen and not the other.
 */
export const REVIEW_SCORE_DIMENSIONS: ReadonlyArray<{
  key: keyof AiReviewScores;
  label: string;
  risk: boolean;
}> = [
  { key: "objectivity", label: "Objectivity", risk: false },
  { key: "publicKnowability", label: "Public knowability", risk: false },
  { key: "sourceQuality", label: "Source quality", risk: false },
  { key: "corroboration", label: "Corroboration", risk: false },
  { key: "contentSafety", label: "Content safety", risk: false },
  { key: "disputeRisk", label: "Dispute risk", risk: true },
  { key: "promptInjectionRisk", label: "Prompt injection risk", risk: true },
];

/**
 * The seven reviewer dimensions as filled 0-5 meters, each with the reviewer's
 * own rationale underneath.
 *
 * The rationale is the point, not decoration: it is the only part of a review
 * that says *why* a dimension scored what it did, which is what a creator
 * iterating on a draft needs in order to fix it. Rendered at one column in a
 * sidebar, two in a full-width card.
 */
export function ReviewScoreBreakdown({
  columns = 1,
  scoreRationales,
  scores,
}: {
  columns?: 1 | 2;
  scoreRationales: AiReviewScoreRationales;
  scores: AiReviewScores;
}) {
  return (
    <div
      className={cn("grid gap-x-8 gap-y-3", columns === 2 ? "sm:grid-cols-2" : null)}
    >
      {REVIEW_SCORE_DIMENSIONS.map((dimension) => (
        <ScoreRow
          key={dimension.key}
          label={dimension.label}
          rationale={scoreRationales[dimension.key]}
          risk={dimension.risk}
          score={scores[dimension.key]}
        />
      ))}
    </div>
  );
}

function ScoreRow({
  label,
  rationale,
  risk,
  score,
}: {
  label: string;
  rationale: string;
  risk: boolean;
  score: number;
}) {
  const filled = Math.min(Math.max(Math.round(score), 0), 5);
  const tone = scoreTone(filled, risk);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
          {label}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {filled}/5
        </span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            className="h-1.5 flex-1 rounded-[var(--radius-pill)]"
            key={index}
            style={{ backgroundColor: index < filled ? tone : "var(--border)" }}
          />
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        {rationale}
      </p>
    </div>
  );
}

/**
 * Maps a 0-5 dimension score to its tone, flipping the scale for risk
 * dimensions so "good" is always the same color regardless of polarity.
 */
function scoreTone(score: number, risk: boolean) {
  const goodness = risk ? 5 - score : score;

  return goodness >= 4 ? "var(--yes)" : goodness >= 2 ? "var(--pc-amber)" : "var(--no)";
}
