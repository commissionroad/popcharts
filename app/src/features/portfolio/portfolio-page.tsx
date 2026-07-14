"use client";

import type {
  PortfolioOpenOrder,
  PortfolioPosition,
  PortfolioReceipt,
} from "@popcharts/api-client/models";
import { Layers, ReceiptText, WalletCards } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/ui/metric-card";
import { wadPriceToCents } from "@/domain/postgrad-trading/limit-order";
import { wadToNumber } from "@/domain/tokens/wad";
import { usePortfolio } from "@/features/portfolio/use-portfolio";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { apiMarketAppId } from "@/lib/app-id";
import {
  formatCents,
  formatDateTime,
  formatTokenAmount,
  formatUsd,
  formatUsdWhole,
} from "@/lib/format";

import { PositionClaim } from "./position-claim";
import { ReceiptSettlement } from "./receipt-settlement";

/**
 * Database-backed portfolio: the connected wallet's pre-graduation receipts
 * (with their settlement results once markets graduate), graduated YES/NO
 * positions, and open venue orders — all read from the indexer, cross-market
 * and cross-device. Most writes (refund claims, order cancels) stay on each
 * market page; the one exception is redeeming a resolved market's winnings,
 * which is offered directly on the position row as well as the market page.
 */
export function PortfolioPage() {
  const wallet = useWalletAccount();
  const { error, loading, portfolio, refresh } = usePortfolio({
    chainId: configuredPopChartsChainId,
    owner: wallet.address,
  });

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Portfolio
        </p>
        <h1 className="font-display text-4xl font-black tracking-normal">
          Receipts and backed positions
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          Pre-graduation receipts stay separate from graduated YES/NO outcome tokens so
          the app never blurs intent with a final fill.
        </p>
      </div>

      {wallet.address ? (
        <ConnectedPortfolio
          error={error}
          loading={loading}
          onClaimed={refresh}
          portfolio={portfolio}
        />
      ) : (
        <NoticeCard
          body="Connect a wallet to see your receipts, graduated positions, and open orders across every market."
          title="No wallet connected"
        />
      )}
    </div>
  );
}

function ConnectedPortfolio({
  error,
  loading,
  onClaimed,
  portfolio,
}: {
  error: string | null;
  loading: boolean;
  onClaimed: () => void;
  portfolio: ReturnType<typeof usePortfolio>["portfolio"];
}) {
  if (error) {
    return <NoticeCard body={error} title="Portfolio unavailable" />;
  }

  if (loading || !portfolio) {
    return (
      <NoticeCard
        body="Reading your receipts, positions, and open orders from the indexer."
        title="Loading portfolio"
      />
    );
  }

  return (
    <>
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<ReceiptText size={20} />}
          label="Open receipts"
          tone="var(--pc-cyan)"
          value={portfolio.summary.openReceiptCount.toLocaleString("en-US")}
        />
        <MetricCard
          icon={<WalletCards size={20} />}
          label="Locked collateral"
          tone="var(--status-graduating)"
          value={formatUsdWhole(
            wadToNumber(BigInt(portfolio.summary.lockedCollateral))
          )}
        />
        <MetricCard
          icon={<Layers size={20} />}
          label="Backed positions"
          tone="var(--yes)"
          value={portfolio.summary.positionCount.toLocaleString("en-US")}
        />
      </div>

      <div className="flex flex-col gap-5">
        {portfolio.receipts.length > 0 ? (
          <ReceiptTable receipts={portfolio.receipts} />
        ) : (
          <NoticeCard
            body="Place a pre-graduation receipt from any bootstrap market and it will appear here while it waits for graduation clearing."
            title="No receipts"
          />
        )}

        {portfolio.positions.length > 0 ? (
          <PositionTable onClaimed={onClaimed} positions={portfolio.positions} />
        ) : (
          <NoticeCard
            body="Graduated YES/NO outcome tokens you hold — or have resting in venue orders — will appear here once a market you backed graduates."
            title="No backed positions"
          />
        )}

        {portfolio.openOrders.length > 0 ? (
          <OpenOrderTable orders={portfolio.openOrders} />
        ) : null}
      </div>
    </>
  );
}

function ReceiptTable({ receipts }: { receipts: PortfolioReceipt[] }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <SectionHeader title="Receipts" />
      <div className="hidden grid-cols-[1.4fr_0.4fr_0.5fr_0.9fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid">
        <span>Market</span>
        <span>Side</span>
        <span>Avg price</span>
        <span>Status</span>
      </div>
      {receipts.map((receipt) => (
        <ReceiptRow key={receipt.receiptId} receipt={receipt} />
      ))}
    </section>
  );
}

function ReceiptRow({ receipt }: { receipt: PortfolioReceipt }) {
  const cost = wadToNumber(BigInt(receipt.cost));
  const shares = wadToNumber(BigInt(receipt.shares));

  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.4fr_0.4fr_0.5fr_0.9fr]">
      <span>
        <MarketLink marketId={receipt.marketId} question={receipt.marketQuestion} />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {formatUsd(cost)} receipt - #{receipt.receiptId}
        </span>
      </span>
      <SideLabel side={receipt.side} />
      <span className="font-mono text-[var(--text-secondary)]">
        {shares > 0 ? formatCents((cost / shares) * 100) : "-"}
      </span>
      <ReceiptSettlement receipt={receipt} />
    </div>
  );
}

function PositionTable({
  onClaimed,
  positions,
}: {
  onClaimed: () => void;
  positions: PortfolioPosition[];
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <SectionHeader title="Backed positions" />
      <div className="hidden grid-cols-[1.4fr_0.4fr_0.5fr_0.5fr_0.5fr_0.6fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid">
        <span>Market</span>
        <span>Side</span>
        <span>Held</span>
        <span>In orders</span>
        <span>Owned</span>
        <span>Value</span>
      </div>
      {positions.map((position) => (
        <PositionRow
          key={`${position.marketId}:${position.side}`}
          onClaimed={onClaimed}
          position={position}
        />
      ))}
    </section>
  );
}

function PositionRow({
  onClaimed,
  position,
}: {
  onClaimed: () => void;
  position: PortfolioPosition;
}) {
  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.4fr_0.4fr_0.5fr_0.5fr_0.5fr_0.6fr]">
      <span>
        <MarketLink marketId={position.marketId} question={position.marketQuestion} />
        {position.avgCostWad ? (
          <span className="font-mono text-xs text-[var(--text-muted)]">
            avg cost {formatCents(wadPriceToCents(BigInt(position.avgCostWad)))}
          </span>
        ) : null}
      </span>
      <SideLabel side={position.side} />
      <span className="font-mono text-[var(--text-secondary)]">
        {formatTokenAmount(BigInt(position.heldBalance))}
      </span>
      <span className="font-mono text-[var(--text-secondary)]">
        {formatTokenAmount(BigInt(position.committedInOrders))}
      </span>
      <span className="font-mono font-bold text-[var(--text-primary)]">
        {formatTokenAmount(BigInt(position.ownedTotal))}
      </span>
      <span className="flex flex-col items-start gap-1.5 text-[var(--text-secondary)]">
        <span>
          {position.currentValueWad
            ? formatUsd(wadToNumber(BigInt(position.currentValueWad)))
            : "-"}
          {position.poolPriceWad ? (
            <span className="block font-mono text-[11px] text-[var(--text-muted)]">
              at {formatCents(wadPriceToCents(BigInt(position.poolPriceWad)))}
            </span>
          ) : null}
        </span>
        <PositionClaim onClaimed={onClaimed} position={position} />
      </span>
    </div>
  );
}

function OpenOrderTable({ orders }: { orders: PortfolioOpenOrder[] }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]">
      <SectionHeader title="Open orders" />
      <div className="hidden grid-cols-[1.4fr_0.4fr_0.6fr_0.5fr_0.7fr] gap-3 border-b border-[var(--border-soft)] px-5 py-3 font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase md:grid">
        <span>Market</span>
        <span>Side</span>
        <span>Order</span>
        <span>Remaining</span>
        <span>Placed</span>
      </div>
      {orders.map((openOrder) => (
        <OpenOrderRow
          key={`${openOrder.order.poolId}:${openOrder.order.orderId}`}
          openOrder={openOrder}
        />
      ))}
    </section>
  );
}

function OpenOrderRow({ openOrder }: { openOrder: PortfolioOpenOrder }) {
  const { order } = openOrder;

  return (
    <div className="grid gap-3 border-b border-[var(--border-soft)] px-5 py-4 text-sm last:border-b-0 md:grid-cols-[1.4fr_0.4fr_0.6fr_0.5fr_0.7fr]">
      <span>
        <MarketLink marketId={openOrder.marketId} question={openOrder.marketQuestion} />
        <span className="font-mono text-xs text-[var(--text-muted)]">
          Manage on the market page
        </span>
      </span>
      <SideLabel side={order.side} />
      <span className="font-mono text-[var(--text-secondary)]">
        {order.direction === "ask" ? "Sell" : "Buy"} at{" "}
        {formatCents(wadPriceToCents(BigInt(order.priceWad)))}
      </span>
      <span className="font-mono text-[var(--text-secondary)]">
        {formatTokenAmount(BigInt(order.remainingSizeWad))}
      </span>
      <span className="text-[var(--text-secondary)]">
        {formatDateTime(order.createdBlockTimestamp)}
      </span>
    </div>
  );
}

function MarketLink({
  marketId,
  question,
}: {
  marketId: string;
  question: string | undefined;
}) {
  const appId = apiMarketAppId({ chainId: configuredPopChartsChainId, marketId });

  return (
    <Link
      className="block text-[var(--text-primary)] transition-opacity hover:opacity-75"
      href={`/markets/${encodeURIComponent(appId)}`}
    >
      {question ?? `Market #${marketId}`}
    </Link>
  );
}

function SideLabel({ side }: { side: "yes" | "no" }) {
  return (
    <span
      className="font-mono font-bold"
      style={{ color: side === "yes" ? "var(--yes)" : "var(--no)" }}
    >
      {side.toUpperCase()}
    </span>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-[var(--border-soft)] px-5 py-3">
      <h2 className="font-display text-lg font-black">{title}</h2>
    </div>
  );
}

function NoticeCard({ body, title }: { body: string; title: string }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
        {title}
      </div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
        {body}
      </p>
    </section>
  );
}
