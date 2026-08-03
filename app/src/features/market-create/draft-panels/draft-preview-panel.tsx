"use client";

import { Info, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  CreateMarketDraft,
  CreateMarketPreview,
} from "@/domain/market-creation/types";
import { formatB, formatUsdWhole } from "@/lib/format";

import {
  CompactMetric,
  PreviewOutcome,
} from "../create-market-panels/live-preview-panel";

/**
 * Edit-stage sidebar of the review-first flow: the live market-card mirror
 * plus the primary "Submit for AI review" action. Review is the front door —
 * a market only goes on-chain after the reviewer approves the draft
 * (ADR 0022), so this panel carries the flow's main CTA.
 */
export function DraftPreviewPanel({
  canPersist,
  draft,
  errorCount,
  isSubmitting,
  onSubmit,
  preview,
}: {
  canPersist: boolean;
  draft: CreateMarketDraft;
  errorCount: number;
  isSubmitting: boolean;
  onSubmit: () => void;
  preview: CreateMarketPreview;
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
          <span className="rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
            Draft
          </span>
        </div>
        <div className="font-display min-h-12 text-xl leading-tight font-bold">
          {draft.question || "Your question appears here"}
        </div>
        <div className="flex gap-2.5">
          <PreviewOutcome
            label={draft.outcomeYes.trim() || "YES"}
            price={draft.openingProbability}
            side="yes"
          />
          <PreviewOutcome
            label={draft.outcomeNo.trim() || "NO"}
            price={100 - draft.openingProbability}
            side="no"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-[var(--border-soft)] pt-3">
          <CompactMetric
            label="Target"
            value={formatUsdWhole(preview.graduationThreshold)}
          />
          <CompactMetric label="b" value={formatB(draft.liquidityParameter)} />
        </div>
      </div>
      <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-raised)] p-4">
        <Info className="mt-0.5 shrink-0 text-[var(--pc-cyan)]" size={16} />
        <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
          An AI reviewer reads every draft before it can go live. It answers in seconds
          and tells you exactly what to fix.
        </p>
      </div>
      {errorCount > 0 ? (
        <div
          className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--surface-raised)] p-4"
          role="alert"
        >
          <Info className="mt-0.5 shrink-0 text-[var(--no)]" size={16} />
          <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Fix {errorCount} {errorCount === 1 ? "field" : "fields"} to submit this
            draft.
          </p>
        </div>
      ) : null}
      <Button
        disabled={isSubmitting}
        glow
        leftIcon={<Sparkles size={18} />}
        onClick={onSubmit}
        size="lg"
      >
        {isSubmitting ? "Submitting…" : "Submit for AI review"}
      </Button>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        {canPersist
          ? "Free while you iterate — pay only when you publish"
          : "Connect a wallet to submit for review"}
      </span>
    </>
  );
}
