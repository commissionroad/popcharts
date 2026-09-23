import { ArrowRight, Undo2 } from "lucide-react";
import Link from "next/link";

import { wadToNumber } from "@/domain/tokens/wad";
import { formatUsd } from "@/lib/format";

import type { ClosedMarketRefund } from "./refund-breakdown";

/**
 * The portfolio's view of every market that ended without graduating — the
 * counterpart to the market page's refund panel, for a holder who is looking at
 * their money rather than at one market.
 *
 * The receipts table below it already lists these receipts individually, and
 * that is exactly the problem this card answers: row by row, four receipts on
 * one dead market read as four unexplained refunds. Here the market is the
 * unit — one row per ending, with the reason, the total coming back, and a link
 * to the page where the claim itself happens. Claiming stays on the market
 * page, so the two surfaces never disagree about what has been claimed.
 *
 * Purely presentational: it takes rows built by `closedMarketRefunds` and holds
 * no hooks, so the portfolio page owns the read and this owns only the telling.
 */
export function RefundSummaryCard({ refunds }: { refunds: ClosedMarketRefund[] }) {
  if (refunds.length === 0) {
    return null;
  }

  const outstandingWad = refunds.reduce(
    (sum, refund) => sum + refund.breakdown.claimableTotalWad,
    0n
  );

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--status-refunded)] bg-[var(--surface-card)] p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--status-refunded)] uppercase">
          <Undo2 size={14} />
          {/* Deliberately not "Closed without graduating": that is one of the
              two endings listed below, and reusing it here would label a
              cancelled market with the other one's reason. */}
          Markets that did not graduate
        </span>
        {outstandingWad > 0n ? (
          <span className="font-display tabular text-lg font-black text-[var(--text-primary)]">
            {formatUsd(wadToNumber(outstandingWad))} to claim
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        {refunds.map((refund) => (
          <RefundRow key={refund.marketAppId} refund={refund} />
        ))}
      </div>
    </section>
  );
}

function RefundRow({ refund }: { refund: ClosedMarketRefund }) {
  const { breakdown, closure, marketAppId, question } = refund;
  const outstanding = breakdown.claimableTotalWad;
  const fee = breakdown.entryFeeTotalWad;

  return (
    <Link
      className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 transition-opacity hover:opacity-80"
      href={`/markets/${marketAppId}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] leading-5 font-bold text-[var(--text-primary)]">
          {question}
        </span>
        <span className="font-mono text-sm font-bold whitespace-nowrap text-[var(--text-primary)]">
          {formatUsd(
            wadToNumber(outstanding > 0n ? outstanding : breakdown.claimedTotalWad)
          )}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
        {closure.summary}
      </p>

      {/* The entry-fee line is the part a holder cannot work out for themselves:
          the fee was charged at purchase and looks spent, so a refund that
          silently includes it reads as short. Named only when the paid fee is
          known — see RefundLine.entryFeeWad. */}
      {outstanding > 0n && fee !== null && fee > 0n ? (
        <p className="mt-0.5 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          Includes {formatUsd(wadToNumber(fee))} of entry fees returned in full.
        </p>
      ) : null}

      <span className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--text-muted)]">
        {outstanding > 0n
          ? `Claim on the market page`
          : `${breakdown.claimed.length} ${
              breakdown.claimed.length === 1 ? "receipt" : "receipts"
            } refunded`}
        <ArrowRight size={12} />
      </span>
    </Link>
  );
}
