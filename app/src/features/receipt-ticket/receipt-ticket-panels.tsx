"use client";

import { CheckCircle2 } from "lucide-react";

import type {
  PlacedPregradReceipt,
  ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import { formatAddress, formatCents, formatUsd } from "@/lib/format";

import {
  formatPriceBand,
  formatPusdBalance,
  formatShares,
} from "./receipt-ticket-format";

/**
 * Shows the connected wallet's pUSD balance for the devchain ticket.
 */
export function CollateralBalancePanel({
  balanceUsd,
  error,
  isLoading,
  walletConnected,
}: {
  balanceUsd: number | null;
  error: string | null;
  isLoading: boolean;
  walletConnected: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-3">
      <div className="min-w-0">
        <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
          pUSD balance
        </div>
        <div className="mt-1 font-mono text-[13px] text-[var(--text-primary)]">
          {formatPusdBalance({ balanceUsd, error, isLoading, walletConnected })}
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only breakdown of the current receipt quote: average price, estimated
 * receipt shares, price band, price impact, and max cost. Renders placeholder
 * dashes while the budget has no valid quote.
 */
export function QuotePreview({
  quote,
  sideColor,
}: {
  quote: ReceiptQuotePreview | null;
  sideColor: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-4">
      <TicketRow
        label="Avg price"
        value={quote ? formatCents(quote.averagePriceCents) : "--"}
      />
      <TicketRow
        label="Est. receipt shares"
        tone={sideColor}
        value={quote ? `${formatShares(quote.shares)} sh` : "--"}
      />
      <TicketRow label="Price band" value={quote ? formatPriceBand(quote) : "--"} />
      <TicketRow
        label="Price impact"
        tone={
          quote && quote.priceImpactCents >= 5 ? "var(--status-graduating)" : undefined
        }
        value={quote ? `+${quote.priceImpactCents.toFixed(2)} pts` : "--"}
      />
      <TicketRow label="Max cost" value={quote ? formatUsd(quote.maxCostUsd) : "--"} />
    </div>
  );
}

/**
 * Confirmation card for a receipt that was just placed: receipt id,
 * collateral, shares, and the transaction hash when it was wallet-signed.
 */
export function PlacedReceiptNotice({ receipt }: { receipt: PlacedPregradReceipt }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--pc-lime)] bg-[var(--pc-lime-wash)] p-3">
      <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-[var(--pc-lime)]">
        <CheckCircle2 size={15} />
        Receipt placed
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-[var(--text-secondary)]">
        <span>
          #{receipt.receiptId} - {formatUsd(receipt.collateralUsd)} -{" "}
          {formatShares(receipt.shares)} sh
        </span>
        {receipt.transactionHash ? (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            Tx {formatAddress(receipt.transactionHash)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TicketRow({
  label,
  tone = "var(--text-primary)",
  value,
}: {
  label: string;
  tone?: string | undefined;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="font-mono text-[var(--text-muted)]">{label}</span>
      <span className="tabular text-right font-mono" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}
