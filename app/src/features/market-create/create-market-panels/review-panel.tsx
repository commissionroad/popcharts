"use client";

import { Rocket, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CreateMarketPreview } from "@/domain/market-creation/types";
import { WAD, wadToNumber } from "@/domain/tokens/wad";
import { formatB, formatUsdWhole } from "@/lib/format";

import type { WalletCreateAction } from "../wallet-create-action";
import { formatDeadlineFromSeconds, ReviewRow } from "./shared";

/**
 * Review-stage sidebar: the full protocol parameter breakdown for the draft
 * plus the submit-for-AI-review and create actions, with wallet guidance and
 * submission errors inline.
 */
export function ReviewPanel({
  createAction,
  creationFeeLabel,
  hasErrors,
  isCreating,
  isSubmittingForReview,
  onCreate,
  onEdit,
  onSubmitForReview,
  preview,
  submitError,
}: {
  createAction: WalletCreateAction | null;
  creationFeeLabel: string | null;
  hasErrors: boolean;
  isCreating: boolean;
  isSubmittingForReview: boolean;
  onCreate: () => void;
  onEdit: () => void;
  onSubmitForReview: () => void;
  preview: CreateMarketPreview;
  submitError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]">
          <Rocket size={17} />
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Review
          </div>
          <h2 className="font-display text-xl font-black">Create market</h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Question" value={preview.metadata.question} />
        <ReviewRow label="Resolution" value={preview.metadata.resolutionCriteria} />
        {preview.metadata.resolutionSources?.length ? (
          <ReviewRow
            label="Sources"
            value={preview.metadata.resolutionSources.join(", ")}
          />
        ) : null}
        {preview.metadata.resolutionUrl ? (
          <ReviewRow label="URL" mono value={preview.metadata.resolutionUrl} />
        ) : null}
        <ReviewRow
          label="Opening"
          value={`YES ${formatWadPercent(preview.protocolParams.openingProbabilityWad)}`}
        />
        <ReviewRow
          label="b"
          mono
          value={formatB(wadToNumber(preview.protocolParams.liquidityParameter))}
        />
        <ReviewRow
          label="Graduation target"
          value={`${formatUsdWhole(preview.graduationThreshold)} matched market cap`}
        />
        <ReviewRow
          label="Graduation"
          value={formatDeadlineFromSeconds(preview.protocolParams.graduationDeadline)}
        />
        <ReviewRow
          label="Resolution"
          value={formatDeadlineFromSeconds(preview.protocolParams.resolutionTime)}
        />
        <ReviewRow
          label="AI resolution"
          value={preview.protocolParams.bypassAiResolution ? "Bypassed" : "Assisted"}
        />
        {creationFeeLabel ? (
          <ReviewRow label="Creation fee" value={creationFeeLabel} />
        ) : null}
        <ReviewRow label="Metadata hash" mono value={preview.metadataHash} />
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

      <Button
        disabled={hasErrors || isCreating || isSubmittingForReview}
        leftIcon={<Send size={18} />}
        onClick={onSubmitForReview}
        size="lg"
      >
        {isSubmittingForReview ? "Submitting..." : "Submit for AI review"}
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          disabled={
            hasErrors || isCreating || isSubmittingForReview || createAction?.disabled
          }
          leftIcon={<Rocket size={18} />}
          onClick={onCreate}
          size="lg"
          variant="secondary"
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
 * Formats a WAD-scaled probability as a percentage with up to two decimal
 * places, truncated ("64.5%"). Kept here rather than consolidated onto
 * lib/format's whole-percent `formatPercent`, which rounds.
 */
function formatWadPercent(value: bigint) {
  return `${Number((value * 10_000n) / WAD) / 100}%`;
}
