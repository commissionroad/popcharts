"use client";

import { Rocket, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { SubmittedMarketReview } from "../create-market-service";
import type { WalletCreateAction } from "../wallet-create-action";
import { ReviewRow } from "./shared";

/**
 * Post-submission sidebar: shows the queued AI review ticket and keeps the
 * create and edit actions available while the review is pending.
 */
export function SubmittedPanel({
  createAction,
  isCreating,
  onCreate,
  onEdit,
  result,
  submitError,
}: {
  createAction: WalletCreateAction | null;
  isCreating: boolean;
  onCreate: () => void;
  onEdit: () => void;
  result: SubmittedMarketReview;
  submitError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--pc-cyan)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]">
          <Sparkles size={19} />
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Review queued
          </div>
          <h2 className="font-display text-xl font-black">Submitted for AI review</h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Review ticket" mono value={result.reviewId} />
        <ReviewRow
          label="AI review"
          value={
            result.aiReview.status === "forwarded"
              ? "Forwarded to reviewer"
              : "Eligible"
          }
        />
        <ReviewRow label="Submitted" value={formatSubmittedAt(result.submittedAt)} />
        <ReviewRow label="Question" value={result.metadata.question} />
        <ReviewRow label="Metadata hash" mono value={result.metadataHash} />
      </div>

      {submitError ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--accent-wash)] px-3 py-2 text-sm text-[var(--no)]">
          {submitError}
        </p>
      ) : null}
      {createAction && createAction.message ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] px-3 py-2 text-sm text-[var(--status-graduating)]">
          {createAction.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          disabled={isCreating || createAction?.disabled}
          leftIcon={<Rocket size={18} />}
          onClick={onCreate}
          size="lg"
        >
          {isCreating ? "Creating..." : (createAction?.label ?? "Create market")}
        </Button>
        <Button className="sm:w-32" onClick={onEdit} size="lg" variant="secondary">
          Edit
        </Button>
      </div>
    </div>
  );
}

/**
 * Formats the review submission timestamp as a medium date with a short time
 * in the viewer's local zone (unlike lib/format's UTC-pinned formatDateTime;
 * this renders client-side only, after submission).
 */
function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
