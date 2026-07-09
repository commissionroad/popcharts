"use client";

import { CheckCircle2 } from "lucide-react";

import type { VenueSwapQuote } from "@/domain/postgrad-trading/venue-trade";
import { venueTokenUnitsToNumber } from "@/domain/postgrad-trading/venue-trade";
import { formatAddress } from "@/lib/format";

import type { VenueLimitOrderReceipt } from "./limit-order-service";
import type { VenueSwapReceipt } from "./postgrad-swap-service";
import {
  formatVenueBalance,
  formatVenuePriceCents,
  formatVenueTokens,
} from "./postgrad-ticket-format";
import type { LimitOrderQuote } from "./use-limit-order-state";

/**
 * Shows the connected wallet's collateral and outcome-token balances for the
 * devchain ticket.
 */
export function VenueBalancesPanel({
  balances,
  noLabel,
  walletConnected,
  yesLabel,
}: {
  balances: {
    collateral: number | null;
    error: string | null;
    loading: boolean;
    no: number | null;
    yes: number | null;
  };
  noLabel: string;
  walletConnected: boolean;
  yesLabel: string;
}) {
  const shared = {
    error: balances.error,
    isLoading: balances.loading,
    walletConnected,
  };
  const rows = [
    {
      label: "pUSD",
      value: formatVenueBalance({
        ...shared,
        balance: balances.collateral,
        unit: "pUSD",
      }),
    },
    {
      label: `${yesLabel} tokens`,
      value: formatVenueBalance({ ...shared, balance: balances.yes, unit: "tok" }),
    },
    {
      label: `${noLabel} tokens`,
      value: formatVenueBalance({ ...shared, balance: balances.no, unit: "tok" }),
    },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
          Wallet balances
        </div>
      </div>
      {rows.map((row) => (
        <div className="flex justify-between gap-4 text-[13px]" key={row.label}>
          <span className="font-mono text-[var(--text-muted)]">{row.label}</span>
          <span className="tabular text-right font-mono text-[var(--text-primary)]">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only breakdown of the current market-order quote: what goes in, the
 * expected output, the effective all-in price against the current pool price,
 * and whether the numbers came from the v4 quoter or a pool-price estimate.
 * Renders placeholder dashes while the amount has no valid quote.
 */
export function SwapQuotePreview({
  quote,
  quoteLoading,
  sideColor,
}: {
  quote: VenueSwapQuote | null;
  quoteLoading: boolean;
  sideColor: string;
}) {
  const amountInNumber = quote ? venueTokenUnitsToNumber(quote.amountIn) : null;
  const amountOutNumber = quote ? venueTokenUnitsToNumber(quote.amountOut) : null;
  const isBuy = quote?.action === "buy";

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-4">
      <TicketRow
        label={isBuy ? "You spend" : "You sell"}
        value={
          quote && amountInNumber !== null
            ? isBuy
              ? `${formatVenueTokens(amountInNumber)} pUSD`
              : `${formatVenueTokens(amountInNumber)} tok`
            : "--"
        }
      />
      <TicketRow
        label={isBuy ? "Est. tokens out" : "Est. pUSD out"}
        tone={sideColor}
        value={
          quote && amountOutNumber !== null
            ? isBuy
              ? `${formatVenueTokens(amountOutNumber)} tok`
              : `${formatVenueTokens(amountOutNumber)} pUSD`
            : "--"
        }
      />
      <TicketRow
        label="Effective price"
        value={quote ? formatVenuePriceCents(quote.effectivePriceCents) : "--"}
      />
      <TicketRow
        label="Pool price"
        value={quote ? formatVenuePriceCents(quote.poolPriceCents) : "--"}
      />
      <TicketRow
        label="Quote source"
        tone={quote?.source === "estimate" ? "var(--status-graduating)" : undefined}
        value={
          quoteLoading
            ? "Refreshing..."
            : quote
              ? quote.source === "quoter"
                ? "Venue quoter"
                : "Estimated from pool price"
              : "--"
        }
      />
    </div>
  );
}

/**
 * Confirmation card for a swap that just settled on the venue: the actual
 * fill amounts from the Swap event, the transaction hash, and a partial-fill
 * notice when the order stopped at the venue's price bound.
 */
export function CompletedSwapNotice({
  noLabel,
  swap,
  yesLabel,
}: {
  noLabel: string;
  swap: VenueSwapReceipt;
  yesLabel: string;
}) {
  const sideLabel = swap.side === "yes" ? yesLabel : noLabel;
  const amountIn = formatVenueTokens(venueTokenUnitsToNumber(swap.amountIn));
  const amountOut = formatVenueTokens(venueTokenUnitsToNumber(swap.amountOut));
  const summary =
    swap.action === "buy"
      ? `Bought ${amountOut} ${sideLabel} tokens for ${amountIn} pUSD`
      : `Sold ${amountIn} ${sideLabel} tokens for ${amountOut} pUSD`;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--pc-lime)] bg-[var(--pc-lime-wash)] p-3">
      <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-[var(--pc-lime)]">
        <CheckCircle2 size={15} />
        Order filled
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-[var(--text-secondary)]">
        <span>{summary}</span>
        {swap.partialFill ? (
          <span className="text-[var(--status-graduating)]">
            Partially filled: the pool reached its price bound, and the unspent
            remainder stayed in your wallet.
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          Tx {formatAddress(swap.transactionHash)}
        </span>
      </div>
    </div>
  );
}

/**
 * Read-only breakdown of the limit order being composed: the resting price,
 * size, the deposit escrowed on placement, and the collateral the order is
 * worth if it fills. Renders placeholder dashes until the form validates.
 */
export function LimitOrderPreview({
  quote,
  sideColor,
}: {
  quote: LimitOrderQuote | null;
  sideColor: string;
}) {
  const isBid = quote?.direction === "bid";
  const sizeNumber = quote ? venueTokenUnitsToNumber(quote.sizeWad) : null;
  const depositNumber = quote ? venueTokenUnitsToNumber(quote.depositWad) : null;
  const filledValue =
    quote !== null && sizeNumber !== null
      ? (sizeNumber * quote.priceCents) / 100
      : null;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-raised)] p-4">
      <TicketRow
        label="Limit price"
        value={quote ? formatVenuePriceCents(quote.priceCents) : "--"}
      />
      <TicketRow
        label="Size"
        tone={sideColor}
        value={sizeNumber !== null ? `${formatVenueTokens(sizeNumber)} tok` : "--"}
      />
      <TicketRow
        label={isBid ? "You deposit" : "You escrow"}
        value={
          quote === null || depositNumber === null
            ? "--"
            : isBid
              ? `${formatVenueTokens(depositNumber)} pUSD`
              : `${formatVenueTokens(depositNumber)} tok`
        }
      />
      <TicketRow
        label="If filled you receive"
        value={
          quote === null || sizeNumber === null || filledValue === null
            ? "--"
            : isBid
              ? `${formatVenueTokens(sizeNumber)} tok`
              : `${formatVenueTokens(filledValue)} pUSD`
        }
      />
    </div>
  );
}

/**
 * Confirmation card for a limit order that is now resting on the venue's
 * book: the order summary, its id, the transaction hash, and honest copy
 * about fill timing — crossed orders can settle via the keeper seconds after
 * the price reaches them.
 */
export function CompletedLimitOrderNotice({
  noLabel,
  order,
  yesLabel,
}: {
  noLabel: string;
  order: VenueLimitOrderReceipt;
  yesLabel: string;
}) {
  const sideLabel = order.side === "yes" ? yesLabel : noLabel;
  const size = formatVenueTokens(venueTokenUnitsToNumber(order.sizeWad));
  const summary =
    order.direction === "bid"
      ? `Buy ${size} ${sideLabel} tokens at ${formatVenuePriceCents(order.priceCents)}`
      : `Sell ${size} ${sideLabel} tokens at ${formatVenuePriceCents(order.priceCents)}`;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--pc-lime)] bg-[var(--pc-lime-wash)] p-3">
      <div className="flex items-center gap-2 font-mono text-[12px] font-bold text-[var(--pc-lime)]">
        <CheckCircle2 size={15} />
        Limit order placed
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-[var(--text-secondary)]">
        <span>{summary}</span>
        <span>
          Resting on the book as order #{order.orderId}. It fills when the market
          crosses your price; fills can land a few seconds after.
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          Tx {formatAddress(order.transactionHash)}
        </span>
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
