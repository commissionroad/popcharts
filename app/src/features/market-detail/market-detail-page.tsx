import { ArrowLeft, BadgeCheck, Coins, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";

import { PriceCurve } from "@/components/charts/price-curve";
import { GraduationBar } from "@/components/ui/graduation-bar";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import type { Market } from "@/domain/markets/types";
import { ReceiptTicket } from "@/features/receipt-ticket/receipt-ticket";
import { formatB, formatPercent, formatUsdCompact } from "@/lib/format";

import { GraduateMarketButton } from "./graduate-market-button";
import { MarketDevSettings } from "./market-dev-settings";

export function MarketDetailPage({ market }: { market: Market }) {
  const canRequestGraduation =
    market.status === "bootstrap" &&
    market.graduationTargetUsd > 0 &&
    market.matchedUsd >= market.graduationTargetUsd &&
    isApiBackedMarket(market);
  const canClosePregradForRefund =
    market.status === "bootstrap" && isApiBackedMarket(market);

  return (
    <div>
      <Link
        className="mb-6 inline-flex items-center gap-2 font-mono text-[13px] text-[var(--text-secondary)] transition-opacity hover:opacity-70"
        href="/"
      >
        <ArrowLeft size={15} /> All markets
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-[var(--radius-pill)] border border-[var(--pc-cyan)] px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-[var(--pc-cyan)] uppercase">
              {market.category}
            </span>
            <div className="flex items-center gap-2">
              <StatusPill status={market.status} />
              {devSettingsAvailable() ? (
                <MarketDevSettings
                  canClosePregrad={canClosePregradForRefund}
                  marketId={market.id}
                />
              ) : null}
            </div>
          </div>

          <h1 className="font-display max-w-3xl text-3xl leading-tight font-black sm:text-4xl">
            {market.question}
          </h1>

          <div className="flex flex-wrap items-baseline gap-7">
            <div>
              <span className="font-display tabular text-5xl font-black text-[var(--yes)]">
                {formatPercent(market.yesPriceCents)}
              </span>
              <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                YES
              </span>
            </div>
            <div>
              <span className="font-display tabular text-3xl font-black text-[var(--no)]">
                {formatPercent(market.noPriceCents)}
              </span>
              <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                NO
              </span>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
              Virtual LMSR - implied probability
            </div>
            <PriceCurve path={market.pricePath} side="yes" />
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
            <GraduationBar
              matchedUsd={market.matchedUsd}
              targetUsd={market.graduationTargetUsd}
            />
            <div className="mt-5 grid gap-3 border-t border-[var(--border-soft)] pt-5 sm:grid-cols-3">
              <SmallMetric label="Volume" value={formatUsdCompact(market.volumeUsd)} />
              <SmallMetric
                label="Receipts"
                value={market.receiptCount.toLocaleString()}
              />
              <SmallMetric label="b" value={formatB(market.b)} />
            </div>
            {market.status === "graduating" ? (
              <Link
                className="mt-5 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-graduating)] bg-[var(--surface-raised)] px-4 py-3 font-mono text-xs tracking-[0.06em] text-[var(--status-graduating)] uppercase"
                href={`/markets/${market.id}/graduation`}
              >
                View graduation clearing
                <TrendingUp size={16} />
              </Link>
            ) : null}
            {market.status === "graduated" ? (
              <GraduatedMarketSummary market={market} />
            ) : null}
            {canRequestGraduation ? (
              <GraduateMarketButton marketId={market.id} />
            ) : null}
          </div>
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <ReceiptTicket market={market} />
          <MetricCard
            icon={<ReceiptText size={20} />}
            label="Receipts waiting"
            tone="var(--pc-cyan)"
            value={market.receiptCount.toLocaleString()}
          />
          <MetricCard
            icon={<Coins size={20} />}
            label="Matched liquidity"
            tone="var(--status-graduating)"
            value={formatUsdCompact(market.matchedUsd)}
          />
        </aside>
      </div>
    </div>
  );
}

function GraduatedMarketSummary({ market }: { market: Market }) {
  const tokensCreated = Math.round(market.matchedUsd).toLocaleString("en-US");
  const refundedUsd = Math.max(market.volumeUsd - market.matchedUsd, 0);

  return (
    <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--status-graduated)] bg-[var(--surface-raised)] p-4">
      <div className="mb-4 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[var(--status-graduated)] uppercase">
        <BadgeCheck size={16} />
        Trading closed
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SmallMetric label="YES tokens" value={tokensCreated} />
        <SmallMetric label="NO tokens" value={tokensCreated} />
        <SmallMetric label="Unmatched refunds" value={formatUsdCompact(refundedUsd)} />
      </div>
      <p className="mt-4 max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
        Matched liquidity created equal YES and NO claim tokens. The remaining
        pre-graduation collateral is marked for refund while post-graduation handoff is
        prepared.
      </p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div className="font-display tabular mt-1 text-xl font-black">{value}</div>
    </div>
  );
}

function isApiBackedMarket(market: Market) {
  return market.chainId !== undefined && market.id.includes(":");
}

function devSettingsAvailable() {
  return process.env.NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED === "true";
}
