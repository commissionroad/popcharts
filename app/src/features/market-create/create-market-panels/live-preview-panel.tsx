"use client";

import { Info, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  CreateMarketDraft,
  CreateMarketPreview,
} from "@/domain/market-creation/types";
import { formatB, formatCents, formatUsdWhole } from "@/lib/format";

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
