"use client";

import type {
  DraftFeedbackItem,
  MarketDraftReview,
} from "@popcharts/api-client/models";
import { AlertOctagon, AlertTriangle, Lightbulb, Pencil, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
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

/** The seven review dimensions as compact bars, tucked into a disclosure. */
export function ReviewScoreBars({ review }: { review: MarketDraftReview }) {
  const rows: ReadonlyArray<{
    inverted?: boolean;
    key: keyof MarketDraftReview["scores"];
    label: string;
  }> = [
    { key: "objectivity", label: "Objectivity" },
    { key: "publicKnowability", label: "Public knowability" },
    { key: "sourceQuality", label: "Source quality" },
    { key: "corroboration", label: "Corroboration" },
    { key: "contentSafety", label: "Content safety" },
    { inverted: true, key: "disputeRisk", label: "Dispute risk" },
    { inverted: true, key: "promptInjectionRisk", label: "Injection risk" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ inverted, key, label }) => {
        const raw = review.scores[key];
        const goodness = inverted ? 5 - raw : raw;
        const color =
          goodness >= 4
            ? "var(--yes)"
            : goodness >= 2
              ? "var(--pc-amber)"
              : "var(--no)";

        return (
          <div
            className="grid grid-cols-[7.5rem_1fr_1.5rem] items-center gap-2"
            key={key}
          >
            <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
              {label}
            </span>
            <div className="h-1.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-raised)]">
              <div
                className="h-full rounded-[var(--radius-pill)]"
                style={{
                  backgroundColor: color,
                  width: `${(goodness / 5) * 100}%`,
                }}
              />
            </div>
            <span className="text-right font-mono text-[11px] text-[var(--text-secondary)]">
              {raw}
            </span>
          </div>
        );
      })}
    </div>
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
        <details className="group border-t border-[var(--border-soft)] pt-3">
          <summary className="focus-ring cursor-pointer list-none font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
            Review scores
          </summary>
          <div className="mt-3">
            <ReviewScoreBars review={review} />
          </div>
        </details>
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
