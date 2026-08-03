"use client";

import type { MarketDraft } from "@popcharts/api-client/models";
import { BookmarkPlus, PartyPopper, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ReviewRow } from "../create-market-panels/shared";

/**
 * Published-draft sidebar: the market is live. Links to the market page (the
 * app addresses markets as `chainId:marketId`), offers the template shelf,
 * and resets for the next one.
 */
export function PublishedPanel({
  draft,
  onSaveTemplate,
  onStartFresh,
  templateSaved,
}: {
  draft: MarketDraft;
  onSaveTemplate: () => void;
  onStartFresh: () => void;
  templateSaved: boolean;
}) {
  const marketAppId =
    draft.publishedChainId !== null && draft.publishedMarketId !== null
      ? `${draft.publishedChainId}:${draft.publishedMarketId}`
      : null;

  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--yes-border)] bg-[var(--surface-card)] p-6">
        <div className="flex items-center gap-2.5">
          <PartyPopper color="var(--yes)" size={22} />
          <div>
            <div className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--yes)] uppercase">
              Market live
            </div>
            <div className="text-[12.5px] text-[var(--text-muted)]">
              Fresh out of the oven
            </div>
          </div>
        </div>
        <p className="font-display text-lg leading-snug font-bold">{draft.question}</p>
        <div className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
          {draft.publishedMarketId !== null ? (
            <ReviewRow label="Market id" mono value={draft.publishedMarketId} />
          ) : null}
          {draft.publishedTransactionHash ? (
            <ReviewRow
              label="Transaction"
              mono
              value={draft.publishedTransactionHash}
            />
          ) : null}
        </div>
      </div>
      {marketAppId ? (
        <Button glow href={`/markets/${marketAppId}`} size="lg">
          View market
        </Button>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button
          disabled={templateSaved}
          leftIcon={<BookmarkPlus size={15} />}
          onClick={onSaveTemplate}
          size="md"
          variant="secondary"
        >
          {templateSaved ? "Template saved" : "Save as template"}
        </Button>
        <Button
          leftIcon={<Plus size={15} />}
          onClick={onStartFresh}
          size="md"
          variant="secondary"
        >
          Create another
        </Button>
      </div>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        It appears on the board as soon as the indexer catches the block
      </span>
    </>
  );
}
