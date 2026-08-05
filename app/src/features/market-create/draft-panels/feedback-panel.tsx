"use client";

import type {
  DraftFeedbackItem,
  MarketDraftReview,
} from "@popcharts/api-client/models";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  Pencil,
  RotateCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ReviewScoreBreakdown } from "@/components/ui/review-score-breakdown";
import { cn } from "@/lib/cn";

/** Severity → color + icon, shared with the inline field callouts. */
export function severityStyle(severity: DraftFeedbackItem["severity"]) {
  switch (severity) {
    case "blocker":
      return {
        color: "var(--no)",
        Icon: AlertOctagon,
        label: "Blocker",
      };
    case "warning":
      return {
        color: "var(--pc-amber)",
        Icon: AlertTriangle,
        label: "Fix this",
      };
    default:
      return {
        color: "var(--pc-cyan)",
        Icon: Lightbulb,
        label: "Tip",
      };
  }
}

/**
 * One piece of review feedback: what's wrong and exactly how to fix it.
 * `compact` renders the field-anchored inline version under a form input.
 */
export function FeedbackItemCard({
  compact = false,
  item,
}: {
  compact?: boolean;
  item: DraftFeedbackItem;
}) {
  const { color, Icon, label } = severityStyle(item.severity);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--surface-raised)]",
        compact ? "p-3" : "p-4"
      )}
      style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color }} />
        <span
          className="font-mono text-[10px] font-bold tracking-[0.12em] uppercase"
          style={{ color }}
        >
          {label}
        </span>
        <span className="text-[13px] font-bold text-[var(--text-primary)]">
          {item.title}
        </span>
      </div>
      {compact ? null : (
        <p className="mt-1.5 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {item.issue}
        </p>
      )}
      <p
        className={cn(
          "text-[12.5px] leading-5 text-[var(--text-secondary)]",
          compact ? "mt-1.5" : "mt-2 border-t border-[var(--border-soft)] pt-2"
        )}
      >
        <span className="font-mono text-[10px] font-bold tracking-[0.1em] text-[var(--text-muted)] uppercase">
          How to fix{" "}
        </span>
        {item.howToFix}
      </p>
    </div>
  );
}

/**
 * The reviewer's dimension scores for a draft, with the rationale for each.
 *
 * Shown on every stage that has a review, approved included — a creator
 * deciding whether to keep polishing needs to see *where* the draft is weak,
 * and an approval with a 2/5 on source quality is exactly the case that used
 * to render as a bare green check.
 */
export function ReviewScorePanel({
  review,
  stale = false,
}: {
  review: MarketDraftReview;
  /**
   * The draft has been edited since this review ran, so the scores describe
   * the previously submitted text rather than what is on screen. Said out
   * loud: silently showing a stale score next to a live form is how a creator
   * concludes their edit fixed something it did not.
   */
  stale?: boolean;
}) {
  return (
    // Open on arrival: scores a creator has to expand to find are scores they
    // do not read. Still a disclosure so it can be folded away once read.
    <details
      className="group rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-4"
      open
    >
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase [&::-webkit-details-marker]:hidden">
        <ChevronDown className="transition-transform group-open:rotate-180" size={14} />
        {stale ? "Scores from last review" : "Review scores"}
      </summary>
      {stale ? (
        <p className="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">
          You&apos;ve edited the draft since this ran. Resubmit to score the current
          version.
        </p>
      ) : null}
      <div className="mt-4">
        <ReviewScoreBreakdown
          scoreRationales={review.scoreRationales}
          scores={review.scores}
        />
      </div>
    </details>
  );
}

/**
 * Post-review sidebar for a rejected or changes-requested draft: the verdict,
 * the actionable feedback list, the dimension scores, and the fix/resubmit
 * actions. The form stays live next to it — fixing is the point.
 */
export function FeedbackPanel({
  isResubmitting,
  onEdit,
  onResubmit,
  review,
  verdict,
}: {
  isResubmitting: boolean;
  onEdit: () => void;
  onResubmit: () => void;
  review: MarketDraftReview;
  verdict: "changes_requested" | "rejected";
}) {
  const rejected = verdict === "rejected";
  const headerColor = rejected ? "var(--no)" : "var(--pc-amber)";

  return (
    <>
      <div
        className="flex flex-col gap-4 rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-6"
        style={{
          borderColor: `color-mix(in srgb, ${headerColor} 45%, transparent)`,
        }}
      >
        <div className="flex items-center justify-between">
          <span
            className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase"
            style={{ color: headerColor }}
          >
            {rejected ? "Not approved" : "Changes requested"}
          </span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            AI review · {review.provider}
          </span>
        </div>
        <p className="font-display text-lg leading-snug font-bold">
          {review.feedback.summary}
        </p>
        <div className="flex flex-col gap-2.5" data-testid="feedback-items">
          {review.feedback.items.map((item) => (
            <FeedbackItemCard item={item} key={`${item.title}-${item.issue}`} />
          ))}
        </div>
        <div className="border-t border-[var(--border-soft)] pt-4">
          <ReviewScoreBreakdown
            scoreRationales={review.scoreRationales}
            scores={review.scores}
          />
        </div>
      </div>
      <Button leftIcon={<Pencil size={16} />} onClick={onEdit} size="lg">
        Fix the draft
      </Button>
      <Button
        disabled={isResubmitting}
        leftIcon={<RotateCw size={16} />}
        onClick={onResubmit}
        size="md"
        variant="secondary"
      >
        {isResubmitting ? "Resubmitting…" : "Resubmit as is"}
      </Button>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        Edits re-run the review with fresh eyes
      </span>
    </>
  );
}
