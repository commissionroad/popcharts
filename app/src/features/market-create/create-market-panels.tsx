"use client";

import {
  CheckCircle2,
  Clock,
  Info,
  Rocket,
  RotateCcw,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  formatDeadline,
  toDateTimeLocalValue,
} from "@/domain/market-creation/create-market";
import type {
  CreatedMarket,
  CreateMarketDraft,
  CreateMarketPreview,
} from "@/domain/market-creation/types";
import { WAD, wadToNumber } from "@/domain/tokens/wad";
import { cn } from "@/lib/cn";
import { formatB, formatCents, formatUsdWhole } from "@/lib/format";

import type { SubmittedMarketReview } from "./create-market-service";
import type { WalletCreateAction } from "./wallet-create-action";

/**
 * Edit-stage sidebar: a live market card mirroring the draft, the
 * receipts-not-fills reminder, the outstanding-error prompt, and the button
 * that advances to the review stage.
 */
export function LivePreviewPanel({
  draft,
  onReview,
  preview,
  reviewErrorCount,
}: {
  draft: CreateMarketDraft;
  onReview: () => void;
  preview: CreateMarketPreview;
  reviewErrorCount: number;
}) {
  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          Live preview
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-[var(--radius-pill)] border border-[var(--pc-cyan)] px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--pc-cyan)] uppercase">
            {draft.category}
          </span>
          <StatusPill size="sm" status="under_review" />
        </div>
        <div className="font-display min-h-12 text-xl leading-tight font-bold">
          {draft.question || "Your question appears here"}
        </div>
        <div className="flex gap-2.5">
          <PreviewOutcome label="YES" price={draft.openingProbability} side="yes" />
          <PreviewOutcome label="NO" price={100 - draft.openingProbability} side="no" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-[var(--border-soft)] pt-3">
          <CompactMetric
            label="Target"
            value={formatUsdWhole(preview.graduationThreshold)}
          />
          <CompactMetric label="b" value={formatB(draft.liquidityParameter)} />
        </div>
      </div>
      <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--accent-wash)] p-4">
        <Info className="mt-0.5 shrink-0 text-[var(--accent)]" size={16} />
        <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
          Bets are receipts, not fills. They clear at graduation; unmatched amounts
          refund at exact path cost.
        </p>
      </div>
      {reviewErrorCount > 0 ? (
        <div
          className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--surface-raised)] p-4"
          role="alert"
        >
          <Info className="mt-0.5 shrink-0 text-[var(--no)]" size={16} />
          <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Fix {reviewErrorCount} {reviewErrorCount === 1 ? "field" : "fields"} to
            review this market.
          </p>
        </div>
      ) : null}
      <Button leftIcon={<Wand2 size={18} />} onClick={onReview} size="lg">
        Review market
      </Button>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        No seed capital required
      </span>
    </>
  );
}

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
 * Post-creation sidebar: summarizes the created market (devchain transaction
 * or mock draft), surfaces any metadata sync failure, and offers reset and
 * view-market actions.
 */
export function SuccessPanel({
  onReset,
  result,
}: {
  onReset: () => void;
  result: CreatedMarket;
}) {
  const onChain = result.creationMode === "devchain";
  const walletSigned = result.creationSigner === "wallet";
  const marketHref =
    onChain && result.chainId
      ? `/markets/${encodeURIComponent(`${result.chainId}:${result.marketId}`)}`
      : undefined;
  const statusTone = onChain ? "var(--status-under-review)" : "var(--status-graduated)";

  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border bg-[var(--surface-card)] p-6"
      style={{ borderColor: statusTone }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] text-[var(--pc-ink)]"
          style={{ backgroundColor: statusTone }}
        >
          {onChain ? <Clock size={20} /> : <CheckCircle2 size={20} />}
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            {onChain
              ? walletSigned
                ? "Wallet-signed"
                : "Devchain relay"
              : "Mock created"}
          </div>
          <h2 className="font-display text-xl font-black">
            {onChain ? "Market under review" : "Market draft ready"}
          </h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Market ID" mono value={result.marketId} />
        {result.transactionHash ? (
          <ReviewRow label="Transaction" mono value={result.transactionHash} />
        ) : null}
        {result.creator ? (
          <ReviewRow label="Creator" mono value={result.creator} />
        ) : null}
        <ReviewRow label="Metadata hash" mono value={result.metadataHash} />
        <ReviewRow
          label="Target"
          value={`${formatUsdWhole(result.graduationThreshold)} matched market cap`}
        />
        <ReviewRow
          label="Graduation"
          value={formatDeadlineFromSeconds(result.protocolParams.graduationDeadline)}
        />
        <ReviewRow
          label="Resolution"
          value={formatDeadlineFromSeconds(result.protocolParams.resolutionTime)}
        />
        <ReviewRow
          label="AI resolution"
          value={result.protocolParams.bypassAiResolution ? "Bypassed" : "Assisted"}
        />
      </div>

      {result.metadataSyncError ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] px-3 py-2 text-sm text-[var(--status-graduating)]">
          Market was created, but its question did not sync to the API:{" "}
          {result.metadataSyncError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          leftIcon={<RotateCcw size={18} />}
          onClick={onReset}
          size="lg"
          variant="secondary"
        >
          Create another
        </Button>
        {marketHref ? (
          <Button className="flex-1" href={marketHref} size="lg" variant="ghost">
            View market
          </Button>
        ) : (
          <Button className="flex-1" disabled size="lg" variant="ghost">
            View market
          </Button>
        )}
      </div>
    </div>
  );
}

function PreviewOutcome({
  label,
  price,
  side,
}: {
  label: string;
  price: number;
  side: "yes" | "no";
}) {
  const color = side === "yes" ? "var(--yes)" : "var(--no)";
  const border = side === "yes" ? "var(--yes-border)" : "var(--no-border)";

  return (
    <div
      className="flex-1 rounded-[var(--radius-md)] border bg-[var(--surface-raised)] p-3.5"
      style={{ borderColor: border }}
    >
      <div className="font-mono text-[11px] font-bold" style={{ color }}>
        {label}
      </div>
      <div className="font-display mt-1 text-[22px] font-black" style={{ color }}>
        {formatCents(price)}
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div className="font-mono text-[13px] text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function ReviewRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1 px-3.5 py-3 sm:grid-cols-[0.45fr_1fr] sm:gap-3">
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 text-sm leading-5 text-[var(--text-primary)]",
          mono ? "font-mono text-[12px] break-all" : null
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatDeadlineFromSeconds(value: bigint) {
  const date = new Date(Number(value) * 1000);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Clock size={13} color="var(--text-muted)" />
      {formatDeadline(toDateTimeLocalValue(date))}
    </span>
  );
}

function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatWadPercent(value: bigint) {
  return `${Number((value * 10_000n) / WAD) / 100}%`;
}
