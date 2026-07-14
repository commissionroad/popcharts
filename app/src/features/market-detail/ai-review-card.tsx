import { ChevronDown, ShieldAlert, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";

import type {
  AiReviewScores,
  AiReviewSourceTier,
  AiReviewVerdict,
  MarketAiReview,
} from "@/domain/markets/types";
import { formatDateTime } from "@/lib/format";

const VERDICT: Record<AiReviewVerdict, { color: string; label: string }> = {
  approve: { color: "var(--yes)", label: "Approved" },
  manual_review: { color: "var(--pc-amber)", label: "Manual review" },
  reject: { color: "var(--no)", label: "Rejected" },
};

/**
 * Display order and polarity for the seven reviewer dimensions. Scores run
 * 0-5; for risk: true dimensions a high score is bad, so the tone scale is
 * inverted.
 */
const SCORE_DIMENSIONS: { key: keyof AiReviewScores; label: string; risk: boolean }[] =
  [
    { key: "objectivity", label: "Objectivity", risk: false },
    { key: "publicKnowability", label: "Public knowability", risk: false },
    { key: "sourceQuality", label: "Source quality", risk: false },
    { key: "corroboration", label: "Corroboration", risk: false },
    { key: "contentSafety", label: "Content safety", risk: false },
    { key: "disputeRisk", label: "Dispute risk", risk: true },
    { key: "promptInjectionRisk", label: "Prompt injection risk", risk: true },
  ];

const SOURCE_TIER: Record<AiReviewSourceTier, { color: string; label: string }> = {
  primary: { color: "var(--pc-lime)", label: "Primary" },
  major_news: { color: "var(--pc-cyan)", label: "Major news" },
  specialist: { color: "var(--pc-violet)", label: "Specialist" },
  ugc: { color: "var(--pc-amber)", label: "UGC" },
  suspicious: { color: "var(--no)", label: "Suspicious" },
  unreachable: { color: "var(--text-muted)", label: "Unreachable" },
  unknown: { color: "var(--text-muted)", label: "Unknown" },
};

export function AiReviewCard({ review }: { review: MarketAiReview }) {
  const verdict = VERDICT[review.verdict];

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          <Sparkles size={14} />
          AI review
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--verdict-color)] px-3 py-1.5 font-mono text-[11px] tracking-[0.1em] text-[var(--verdict-color)] uppercase"
          style={{ "--verdict-color": verdict.color } as CSSProperties}
        >
          <span className="size-1.5 rounded-[var(--radius-pill)] bg-current" />
          {verdict.label}
        </span>
      </div>

      <div className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
        {reviewerLabel(review)} · {formatDateTime(review.reviewedAt)}
      </div>

      {review.hardFlags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {review.hardFlags.map((flag) => (
            <span
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--no)] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--no)] uppercase"
              key={flag}
            >
              <ShieldAlert size={12} />
              {flag.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-x-8 gap-y-3 border-t border-[var(--border-soft)] pt-5 sm:grid-cols-2">
        {SCORE_DIMENSIONS.map((dimension) => (
          <ScoreRow
            key={dimension.key}
            label={dimension.label}
            risk={dimension.risk}
            rationale={review.scoreRationales[dimension.key]}
            score={review.scores[dimension.key]}
          />
        ))}
      </div>

      {review.reasons.length > 0 ? (
        <div className="mt-5 border-t border-[var(--border-soft)] pt-5">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Reviewer notes
          </div>
          <ul className="flex max-w-2xl list-disc flex-col gap-1.5 pl-5 text-[13px] leading-6 text-[var(--text-secondary)]">
            {review.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.evidence.length > 0 ? (
        <details className="group mt-5 border-t border-[var(--border-soft)] pt-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="transition-transform group-open:rotate-180"
              size={14}
            />
            Evidence ({review.evidence.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {review.evidence.map((item) => (
              <li
                className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-raised)] p-3"
                key={item.url}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="font-mono text-[12px] break-all text-[var(--pc-cyan)] transition-opacity hover:opacity-70"
                    href={item.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {item.title?.trim() || item.domain}
                  </a>
                  <SourceTierBadge tier={item.sourceTier} />
                </div>
                <p className="mt-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {item.summary}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
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
  const goodness = risk ? 5 - filled : filled;
  const tone =
    goodness >= 4 ? "var(--yes)" : goodness >= 2 ? "var(--pc-amber)" : "var(--no)";

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
            style={{
              backgroundColor: index < filled ? tone : "var(--border)",
            }}
          />
        ))}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        {rationale}
      </p>
    </div>
  );
}

function SourceTierBadge({ tier }: { tier: AiReviewSourceTier }) {
  const config = SOURCE_TIER[tier];

  return (
    <span
      className="rounded-[var(--radius-pill)] border border-current px-2 py-0.5 font-mono text-[9px] tracking-[0.08em] uppercase"
      style={{ color: config.color }}
    >
      {config.label}
    </span>
  );
}

function reviewerLabel(review: MarketAiReview) {
  if (review.modelId?.trim()) {
    return review.modelId;
  }

  if (review.provider === "heuristic") {
    return review.reasons.some((reason) => reason.includes("review unavailable"))
      ? "Deterministic fallback"
      : "Deterministic checks";
  }

  return review.provider;
}
