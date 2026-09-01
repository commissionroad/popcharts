import { Undo2 } from "lucide-react";

import { SmallMetric } from "@/components/ui/small-metric";
import type { Market } from "@/domain/markets/types";
import { marketClosure } from "@/features/portfolio/refund-breakdown";
import { formatUsdCompact, formatUsdWhole } from "@/lib/format";

/**
 * The headline outcome of a market that ended without graduating — the twin of
 * the page's resolved and graduated summaries, for the third ending those two
 * do not cover.
 *
 * A refunded or pre-graduation-cancelled market has no winner, no venue and no
 * outcome tokens; what it has is money going back. So this says why the market
 * ended and how much is being returned, and leaves the claim itself to the
 * refund panel in the aside — the same division the resolved summary keeps with
 * the claim-winnings panel.
 *
 * Rendered for every viewer, connected or not: unlike the refund panel, which
 * is about *your* money and hides when there is none, the ending of the market
 * is a fact about the market and belongs on the page for anyone reading it.
 */
export function ClosedMarketSummary({ market }: { market: Market }) {
  const closure = marketClosure(market);

  if (!closure) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--status-refunded)] bg-[var(--surface-raised)] p-5">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[var(--status-refunded)] uppercase">
        <Undo2 size={16} />
        {closure.headline}
      </div>
      <p className="max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
        {closure.detail}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {/* Volume, not matched cost, is what refunds: nothing cleared, so every
            dollar that entered the receipt book leaves it again. */}
        <SmallMetric label="Refunding" value={formatUsdCompact(market.volumeUsd)} />
        <SmallMetric
          label="Receipts"
          value={market.receiptCount.toLocaleString("en-US")}
        />
        <SmallMetric
          label="Graduation target"
          value={
            market.graduationTargetUsd > 0
              ? formatUsdWhole(market.graduationTargetUsd)
              : "—"
          }
        />
      </div>
    </div>
  );
}
