"use client";

import type {
  PortfolioPosition,
  PortfolioReceipt,
  PortfolioReceiptStatus,
} from "@popcharts/api-client/models";
import Link from "next/link";

import { type Market, marketSideLabel } from "@/domain/markets/types";
import { wadPriceToCents } from "@/domain/postgrad-trading/limit-order";
import { wadToNumber } from "@/domain/tokens/wad";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
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
  const { portfolio } = usePortfolio({
    chainId: configuredPopChartsChainId,
    owner: wallet.address,
  });

  const marketId = parseApiMarketAppId(market.id)?.marketId ?? null;

  if (!wallet.address || !portfolio || !marketId) {
    return null;
  }

  const graduated = market.status === "graduated";
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
          <ReceiptRow key={receipt.receiptId} market={market} receipt={receipt} />
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

const RECEIPT_STATUS_LABEL: Record<PortfolioReceiptStatus, string> = {
  awaiting_graduation: "Waiting for graduation",
  claimable: "Ready to claim",
  refund_claimable: "Refund available",
  refunded: "Refunded",
  settled: "Settled",
};

function ReceiptRow({
  market,
  receipt,
}: {
  market: Market;
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
        <span>· {RECEIPT_STATUS_LABEL[receipt.status]}</span>
      </div>
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
