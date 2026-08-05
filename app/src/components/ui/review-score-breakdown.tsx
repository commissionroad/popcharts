import type { AiReviewScoreRationales, AiReviewScores } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

/**
 * Display order for the seven reviewer dimensions, defined once for every
 * surface that renders them. A dimension added server-side surfaces here as a
 * type error on {@link AiReviewScores} rather than silently going unrendered on
 * one screen and not the other.
 *
 * The reviewer scores two of them as *risks*, where 0 is the good end. Those
 * are inverted for display and renamed to what the score is measuring when you
 * read it as good news, so that on screen every dimension means the same thing:
 * five filled bars is the best a market can do. A meter that fills toward "bad"
 * for two rows out of seven is a misreading waiting to happen — an unflagged
 * market showed an empty bar next to "Prompt injection risk 0/5", which reads as
 * a failing grade for a perfect score.
 *
 * Only the display flips. `AiReviewScores` keeps the reviewer's own risk
 * semantics, because that is what the model and the heuristic actually emit.
 */
export const REVIEW_SCORE_DIMENSIONS: ReadonlyArray<{
  /** Show `5 - score`: the reviewer scores this as a risk, 0 being good. */
  invertsRisk: boolean;
  key: keyof AiReviewScores;
  label: string;
}> = [
  { invertsRisk: false, key: "objectivity", label: "Objectivity" },
  { invertsRisk: false, key: "publicKnowability", label: "Public knowability" },
  { invertsRisk: false, key: "sourceQuality", label: "Source quality" },
  { invertsRisk: false, key: "corroboration", label: "Corroboration" },
  { invertsRisk: false, key: "contentSafety", label: "Content safety" },
  { invertsRisk: true, key: "disputeRisk", label: "Dispute resistance" },
  {
    invertsRisk: true,
    key: "promptInjectionRisk",
    label: "Prompt injection security",
  },
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
          score={displayScore(scores[dimension.key], dimension.invertsRisk)}
        />
      ))}
    </div>
  );
}

/**
 * Turns a reviewer score into the one this component draws: clamped to 0-5, and
 * flipped for risk dimensions so higher is better everywhere. Clamping before
 * flipping is what makes an out-of-range risk score land at the right end — a
 * raw 7 is a maxed-out risk, so it has to display as 0, not -2.
 */
function displayScore(score: number, invertsRisk: boolean): number {
  const clamped = Math.min(Math.max(Math.round(score), 0), 5);

  return invertsRisk ? 5 - clamped : clamped;
}

function ScoreRow({
  label,
  rationale,
  score,
}: {
  label: string;
  rationale: string;
  score: number;
}) {
  const tone = scoreTone(score);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
          {label}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {score}/5
        </span>
      </div>
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            className="h-1.5 flex-1 rounded-[var(--radius-pill)]"
            key={index}
            style={{ backgroundColor: index < score ? tone : "var(--border)" }}
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
 * Maps a 0-5 displayed score to its tone. No polarity argument: every score
 * reaching here already runs the same direction, which is the point of
 * inverting the risk dimensions up front.
 */
function scoreTone(score: number) {
  return score >= 4 ? "var(--yes)" : score >= 2 ? "var(--pc-amber)" : "var(--no)";
}
