"use client";

import { Loader2, Undo2 } from "lucide-react";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { wadToNumber } from "@/domain/tokens/wad";
import {
  marketClosure,
  refundBreakdown,
  type RefundLine,
  refundSplitRows,
} from "@/features/portfolio/refund-breakdown";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { useRefundClaim } from "@/integrations/contracts/hooks/use-refund-claim";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatUsd } from "@/lib/format";

/**
 * The claim surface for a market that ended without graduating — the refund
 * twin of `ClaimWinningsPanel`, and the answer to the gap ADR 0013 names: a
 * holder landing on a `refunded` or pre-graduation-cancelled market could
 * previously only reach their money through the dev menu.
 *
 * It reads as that panel's sibling on purpose. Same placement in the aside,
 * same eyebrow-plus-explanation-plus-action shape, same hide-rather-than-show-
 * empty-chrome rule for viewers with no stake. What differs is what is being
 * claimed: nothing cleared, so there are no winning tokens to burn — each
 * receipt returns its escrowed cost, plus the entry fee paid on it, which the
 * protocol earns only on matched volume and therefore returns in full here
 * (protocol ADR 0014 §3).
 *
 * Each receipt is its own on-chain claim, so each row owns its own claim state
 * and its own retry; the header carries the market-level total so the reader
 * knows what the whole ending is worth without adding rows up.
 *
 * `entryFees` maps receipt id to the WAD-scaled fee paid on that receipt. It is
 * a prop rather than a derivation because ADR 0014 requires the fee to come
 * from the amount stored on the receipt — deriving it from the current rate
 * pays today's rate on an old receipt. `PortfolioReceipt` does not carry it
 * yet, so the panel renders escrow alone when it is not supplied.
 */
export function RefundPanel({
  entryFees,
  market,
}: {
  entryFees?: Record<string, string>;
  market: Market;
}) {
  const wallet = useWalletAccount();
  const { portfolio, refresh } = usePortfolio({
    chainId: configuredPopChartsChainId,
    owner: wallet.address,
  });

  const closure = marketClosure(market);
  const marketId = parseApiMarketAppId(market.id)?.marketId ?? null;

  if (!closure || !marketId || !wallet.address || !portfolio) {
    return null;
  }

  const breakdown = refundBreakdown(
    portfolio.receipts.filter((receipt) => receipt.marketId === marketId),
    entryFees
  );
  const outstanding = breakdown.claimable.length > 0;

  // Nothing owed and nothing taken means this viewer never held a receipt
  // here. The page's closed-market summary already explains the ending to
  // them; a panel about their money would be empty chrome.
  if (!outstanding && breakdown.claimed.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--status-refunded)] bg-[var(--surface-card)] p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--status-refunded)] uppercase">
        <Undo2 size={14} />
        {outstanding ? "Refund available" : "Refund claimed"}
      </div>

      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        {closure.summary}
      </p>

      {outstanding ? (
        <>
          <div className="mt-4 flex flex-col gap-1.5 border-y border-[var(--border-soft)] py-3">
            {refundSplitRows(breakdown).map((row, index, rows) => (
              <div
                className="flex items-baseline justify-between gap-3 font-mono text-[11px]"
                key={row.label}
              >
                <span className="text-[var(--text-muted)]">{row.label}</span>
                <span
                  className={
                    index === rows.length - 1
                      ? "font-display tabular text-base font-black text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)]"
                  }
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-2.5">
            {breakdown.claimable.map((line) => (
              <RefundClaimRow
                key={line.receiptId}
                line={line}
                market={market}
                onClaimed={refresh}
                showReceiptId={breakdown.claimable.length > 1}
              />
            ))}
          </div>
        </>
      ) : null}

      {breakdown.claimed.length > 0 ? (
        <p className="mt-3 font-mono text-[11px] leading-5 text-[var(--text-muted)]">
          {formatUsd(wadToNumber(breakdown.claimedTotalWad))} already returned across{" "}
          {breakdown.claimed.length} claimed{" "}
          {breakdown.claimed.length === 1 ? "receipt" : "receipts"}.
        </p>
      ) : null}
    </section>
  );
}

/**
 * One receipt's refund and the button that pulls it. Mirrors the position
 * panel's claim affordance — same wording, same double-claim guard: a
 * confirmed claim locks the button while the still-`refund_claimable` row
 * waits for the indexer to project the `refunded` state.
 *
 * A failed claim keeps the button live rather than locking it, so the retry is
 * the same button the holder already pressed; the revert message sits directly
 * beneath it.
 */
function RefundClaimRow({
  line,
  market,
  onClaimed,
  showReceiptId,
}: {
  line: RefundLine;
  market: Market;
  onClaimed: () => void;
  showReceiptId: boolean;
}) {
  const { claim, error, status } = useRefundClaim({ onClaimed });
  const pending = status === "pending";
  const claimed = status === "success";
  const failed = status === "error";

  return (
    <div className="flex flex-col gap-1.5">
      {/* The row names which receipt the button below claims; the amount lives
          on the button alone, because printing it twice on one row reads as two
          different figures at a glance. */}
      <div className="flex items-baseline gap-1.5 font-mono text-[11px]">
        <span
          className="font-bold"
          style={{ color: line.side === "yes" ? "var(--yes)" : "var(--no)" }}
        >
          {marketSideLabel(market, line.side)}
        </span>
        {showReceiptId ? (
          <span className="text-[var(--text-muted)]">#{line.receiptId}</span>
        ) : null}
      </div>
      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-2 font-mono text-[12px] font-bold text-[var(--text-primary)] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || claimed}
        onClick={() => claim(line.receiptId)}
        type="button"
      >
        {pending ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Claiming refund…
          </>
        ) : claimed ? (
          "Refund claimed"
        ) : failed ? (
          `Try again — claim ${formatUsd(wadToNumber(line.totalWad))}`
        ) : (
          `Claim ${formatUsd(wadToNumber(line.totalWad))}`
        )}
      </button>
      {error ? (
        <span className="text-[11px] leading-5 text-[var(--danger)]">{error}</span>
      ) : null}
    </div>
  );
}
