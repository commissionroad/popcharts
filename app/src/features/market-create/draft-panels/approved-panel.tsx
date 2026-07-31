"use client";

import type { MarketDraft } from "@popcharts/api-client/models";
import { BadgeCheck, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { WalletCreateAction } from "@/features/market-create/wallet-create-action";
import { formatUsdWhole } from "@/lib/format";

import { ReviewRow } from "../create-market-panels/shared";

/**
 * Approved-draft sidebar: the green light plus the "Publish & pay" step that
 * turns the draft into an on-chain market. Deadlines are shown as windows —
 * the absolute timestamps are minted server-side at the moment of publish
 * (ADR 0022), so an approved draft never goes stale waiting here.
 */
export function ApprovedPanel({
  creationFeeLabel,
  draft,
  graduationThreshold,
  isPublishing,
  onPublish,
  walletAction,
}: {
  creationFeeLabel: string;
  draft: MarketDraft;
  graduationThreshold: number;
  isPublishing: boolean;
  onPublish: () => void;
  walletAction: WalletCreateAction | null;
}) {
  const blocked = walletAction !== null && walletAction.kind !== "ready";
  const buttonLabel = isPublishing
    ? "Publishing…"
    : blocked
      ? walletAction.label
      : "Publish & pay";

  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--yes-border)] bg-[var(--surface-card)] p-6">
        <div className="flex items-center gap-2.5">
          <BadgeCheck color="var(--yes)" size={22} />
          <div>
            <div className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--yes)] uppercase">
              Approved
            </div>
            <div className="text-[12.5px] text-[var(--text-muted)]">
              Ready to go live whenever you are
            </div>
          </div>
        </div>
        <p className="font-display text-lg leading-snug font-bold">{draft.question}</p>
        <div className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
          <ReviewRow
            label="Graduation window"
            value={formatWindow(draft.graduationWindowSeconds)}
          />
          <ReviewRow
            label="Resolution window"
            value={formatWindow(draft.resolutionWindowSeconds)}
          />
          <ReviewRow
            label="Target"
            value={`${formatUsdWhole(graduationThreshold)} matched`}
          />
          <ReviewRow label="Creation fee" value={creationFeeLabel} />
        </div>
        <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
          Windows start counting at publish. Editing the draft instead sends it back
          through review.
        </p>
      </div>
      <Button
        disabled={isPublishing || (blocked && walletAction.disabled)}
        glow
        leftIcon={<Rocket size={18} />}
        onClick={onPublish}
        size="lg"
      >
        {buttonLabel}
      </Button>
      {blocked && walletAction.message ? (
        <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
          {walletAction.message}
        </span>
      ) : (
        <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
          Pays the creation fee and signs createMarket
        </span>
      )}
    </>
  );
}

/** "3d 4h" style rendering of a relative window. */
export function formatWindow(windowSeconds: number): string {
  const units: Array<[label: string, seconds: number]> = [
    ["d", 24 * 60 * 60],
    ["h", 60 * 60],
    ["m", 60],
  ];
  const parts: string[] = [];
  let remaining = windowSeconds;

  for (const [label, seconds] of units) {
    const count = Math.floor(remaining / seconds);

    if (count > 0) {
      parts.push(`${count}${label}`);
      remaining -= count * seconds;
    }

    if (parts.length === 2) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(" ") : "under a minute";
}
