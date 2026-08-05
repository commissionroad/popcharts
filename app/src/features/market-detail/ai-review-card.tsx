import { ChevronDown, ShieldAlert, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";

import { ReviewScoreBreakdown } from "@/components/ui/review-score-breakdown";
import type {
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

      <div className="mt-5 border-t border-[var(--border-soft)] pt-5">
        <ReviewScoreBreakdown
          columns={2}
          scoreRationales={review.scoreRationales}
          scores={review.scores}
        />
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
