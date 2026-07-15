"use client";

import type { PortfolioPosition, PortfolioReceipt } from "@popcharts/api-client/models";
import Link from "next/link";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { wadPriceToCents } from "@/domain/postgrad-trading/limit-order";
import { wadToNumber } from "@/domain/tokens/wad";
import {
  ReceiptSettlement,
  receiptSettlementResult,
} from "@/features/portfolio/receipt-settlement";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { useRefundClaim } from "@/integrations/contracts/hooks/use-refund-claim";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatCents, formatTokenAmount, formatUsd } from "@/lib/format";

/**
 * The connected wallet's stake in THIS market, surfaced next to the ticket so a
 * holder does not have to leave for the portfolio page to see what they hold.
 * Graduated markets show held/committed YES/NO outcome tokens and their live
 * value; pre-graduation markets show the priced receipts still waiting on
 * clearing — the product language stays "receipts", not "positions", until a
 * market graduates. The card stays hidden until there is something to show, so
 * it never adds empty chrome for a disconnected or uninvolved viewer.
 *
 * Values mirror the portfolio page's conversions exactly (same indexed read via
 * `usePortfolio`); it deliberately shows entry vs. current price rather than a
 * derived P&L, which the app defers.
 */
export function MarketPositionPanel({ market }: { market: Market }) {
  const wallet = useWalletAccount();
  const { portfolio, refresh } = usePortfolio({
    chainId: configuredPopChartsChainId,
    owner: wallet.address,
  });

  const marketId = parseApiMarketAppId(market.id)?.marketId ?? null;

  if (!wallet.address || !portfolio || !marketId) {
    return null;
  }

  // Graduated and settled markets live in outcome-token positions; the
  // receipt view only applies while the receipt book is still the market. A
  // `cancelled` status counts only with a postgrad terminal event (a draw) —
  // a pregrad admin-cancel has no resolution and must keep the receipt view,
  // where the refund claim button lives.
  const graduated =
    market.status === "graduated" ||
    market.status === "resolved" ||
    (market.status === "cancelled" && market.resolution?.kind === "cancelled");
  const positions = graduated
    ? portfolio.positions.filter((position) => position.marketId === marketId)
    : [];
  const receipts = graduated
    ? []
    : portfolio.receipts.filter((receipt) => receipt.marketId === marketId);

  if (positions.length === 0 && receipts.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          {graduated ? "Your position" : "Your receipts"}
        </span>
        {graduated ? <TotalValue positions={positions} /> : null}
      </div>

      <div className="flex flex-col gap-2.5">
        {positions.map((position) => (
          <PositionRow key={position.side} market={market} position={position} />
        ))}
        {receipts.map((receipt) => (
          <ReceiptRow
            key={receipt.receiptId}
            market={market}
            onClaimed={refresh}
            receipt={receipt}
          />
        ))}
      </div>

      <Link
        className="mt-4 inline-block font-mono text-[11px] text-[var(--text-secondary)] transition-opacity hover:opacity-70"
        href="/portfolio"
      >
        View full portfolio →
      </Link>
    </section>
  );
}

/** Headline total across the market's held outcome tokens, when priced. */
function TotalValue({ positions }: { positions: PortfolioPosition[] }) {
  const total = positions.reduce(
    (sum, position) =>
      position.currentValueWad
        ? sum + wadToNumber(BigInt(position.currentValueWad))
        : sum,
    0
  );

  if (total <= 0) {
    return null;
  }

  return (
    <span className="font-display tabular text-lg font-black">{formatUsd(total)}</span>
  );
}

function PositionRow({
  market,
  position,
}: {
  market: Market;
  position: PortfolioPosition;
}) {
  const committed = BigInt(position.committedInOrders);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <SideLabel
          label={marketSideLabel(market, position.side)}
          side={position.side}
        />
        <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
          {position.currentValueWad
            ? formatUsd(wadToNumber(BigInt(position.currentValueWad)))
            : "—"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-[var(--text-muted)]">
        <span>{formatTokenAmount(BigInt(position.ownedTotal))} tok</span>
        {position.avgCostWad ? (
          <span>· avg {formatCents(wadPriceToCents(BigInt(position.avgCostWad)))}</span>
        ) : null}
        {position.poolPriceWad ? (
          <span>
            · now {formatCents(wadPriceToCents(BigInt(position.poolPriceWad)))}
          </span>
        ) : null}
      </div>
      {committed > 0n ? (
        <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
          {formatTokenAmount(BigInt(position.heldBalance))} held ·{" "}
          {formatTokenAmount(committed)} in orders
        </div>
      ) : null}
    </div>
  );
}

function ReceiptRow({
  market,
  onClaimed,
  receipt,
}: {
  market: Market;
  onClaimed: () => void;
  receipt: PortfolioReceipt;
}) {
  const cost = wadToNumber(BigInt(receipt.cost));
  const shares = wadToNumber(BigInt(receipt.shares));

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <SideLabel label={marketSideLabel(market, receipt.side)} side={receipt.side} />
        <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
          {formatUsd(cost)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-[var(--text-muted)]">
        <span>{formatTokenAmount(BigInt(receipt.shares))} tok</span>
        {shares > 0 ? <span>· {formatCents((cost / shares) * 100)} avg</span> : null}
      </div>
      <div className="mt-1 text-[11px]">
        {receipt.status === "refund_claimable" ? (
          <ReceiptRefundClaim onClaimed={onClaimed} receipt={receipt} />
        ) : (
          <ReceiptSettlement receipt={receipt} />
        )}
      </div>
    </div>
  );
}

/**
 * The market-page affordance for a claimable full refund: the headline amount
 * plus a working Claim button that pulls the refund with the connected wallet.
 * Replaces the portfolio's "claim on the market page" pointer, since the button
 * lives right here. On a confirmed claim it refreshes the portfolio so the row
 * flips to `refunded` once the indexer projects the event; the button stays out
 * of action in the meantime so the still-`refund_claimable` row can't be
 * double-claimed.
 */
function ReceiptRefundClaim({
  onClaimed,
  receipt,
}: {
  onClaimed: () => void;
  receipt: PortfolioReceipt;
}) {
  const { claim, error, status } = useRefundClaim({ onClaimed });
  const pending = status === "pending";
  const claimed = status === "success";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[var(--text-secondary)]">
        {receiptSettlementResult(receipt).label}
      </span>
      <button
        className="inline-flex w-fit items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--text-primary)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || claimed}
        onClick={() => claim(receipt.receiptId)}
        type="button"
      >
        {pending ? "Claiming refund…" : claimed ? "Refund claimed" : "Claim refund"}
      </button>
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </div>
  );
}

function SideLabel({ label, side }: { label: string; side: "yes" | "no" }) {
  return (
    <span
      className="font-mono text-[13px] font-bold"
      style={{ color: side === "yes" ? "var(--yes)" : "var(--no)" }}
    >
      {label}
    </span>
  );
}
