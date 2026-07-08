import { ArrowLeft, BadgeCheck, Coins, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";

import { PriceCurve } from "@/components/charts/price-curve";
import { GraduationBar } from "@/components/ui/graduation-bar";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import {
  type Market,
  marketSideLabel,
  type PricePathPoint,
} from "@/domain/markets/types";
import { PostgradTradePanel } from "@/features/postgrad-ticket/postgrad-ticket";
import { ReceiptTicket } from "@/features/receipt-ticket/receipt-ticket";
import { formatB, formatPercent, formatUsdCompact } from "@/lib/format";

import { AiReviewCard } from "./ai-review-card";
import { GraduateMarketButton } from "./graduate-market-button";
import { MarketAboutCard } from "./market-about-card";
import { MarketDevSettings } from "./market-dev-settings";

export function MarketDetailPage({
  market,
  pricePath,
}: {
  market: Market;
  pricePath?: PricePathPoint[];
}) {
  const chartPoints = pricePath ?? market.pricePath.map((cents) => ({ cents }));
  // Once a market graduates the receipt book is history: the page leads with
  // the graduation outcome and drops the pre-graduation progress/trading UI.
  const isGraduated = market.status === "graduated";
  // The graduate button is the manual fallback for a market that earned
  // graduation but was not yet picked up by the keeper — it never forces
  // liquidity, so it only shows once the threshold is met.
  const canRequestGraduation =
    market.status === "bootstrap" &&
    market.graduationTargetUsd > 0 &&
    market.matchedUsd >= market.graduationTargetUsd &&
    isApiBackedMarket(market);
  const canClosePregradForRefund =
    market.status === "bootstrap" && isApiBackedMarket(market);
  // Force graduation mints whatever liquidity the threshold still needs, so
  // dev settings offer it for any market still on the pregrad side.
  const canForceGraduate =
    (market.status === "bootstrap" || market.status === "graduating") &&
    isApiBackedMarket(market);

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
                  canForceGraduate={canForceGraduate}
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
                {marketSideLabel(market, "yes")}
              </span>
            </div>
            <div>
              <span className="font-display tabular text-3xl font-black text-[var(--no)]">
                {formatPercent(market.noPriceCents)}
              </span>
              <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
                {marketSideLabel(market, "no")}
              </span>
            </div>
          </div>

          {isGraduated ? <GraduatedMarketSummary market={market} /> : null}

          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
              {isGraduated
                ? "Pre-graduation price history"
                : "Virtual LMSR - implied probability"}
            </div>
            <PriceCurve
              noLabel={marketSideLabel(market, "no")}
              points={chartPoints}
              yesLabel={marketSideLabel(market, "yes")}
            />
          </div>

          {isGraduated ? null : (
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
              <GraduationBar
                matchedUsd={market.matchedUsd}
                targetUsd={market.graduationTargetUsd}
              />
              <div className="mt-5 grid gap-3 border-t border-[var(--border-soft)] pt-5 sm:grid-cols-3">
                <SmallMetric
                  label="Volume"
                  value={formatUsdCompact(market.volumeUsd)}
                />
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
              {canRequestGraduation ? (
                <GraduateMarketButton marketId={market.id} />
              ) : null}
            </div>
          )}

          <MarketAboutCard market={market} />

          {market.aiReview ? <AiReviewCard review={market.aiReview} /> : null}
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          {isGraduated ? (
            <PostgradTradePanel market={market} />
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function GraduatedMarketSummary({ market }: { market: Market }) {
  const postgrad = market.postgrad;
  const venue = postgrad?.venue;
  const tokensCreated = Math.round(
    postgrad?.completeSets ?? market.matchedUsd
  ).toLocaleString("en-US");
  const refundedUsd = postgrad
    ? postgrad.refundedUsd
    : Math.max(market.volumeUsd - market.matchedUsd, 0);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--status-graduated)] bg-[var(--surface-raised)] p-5">
      <div className="mb-4 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[var(--status-graduated)] uppercase">
        <BadgeCheck size={16} />
        {venue?.live ? "Graduated - postgrad venue live" : "Receipt book settled"}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <SmallMetric
          label={`${marketSideLabel(market, "yes")} tokens`}
          value={tokensCreated}
        />
        <SmallMetric
          label={`${marketSideLabel(market, "no")} tokens`}
          value={tokensCreated}
        />
        <SmallMetric label="Unmatched refunds" value={formatUsdCompact(refundedUsd)} />
      </div>
      {postgrad ? (
        <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Postgrad handoff
          </div>
          <ContractAddressRow label="Postgrad market" value={postgrad.marketAddress} />
          <ContractAddressRow label="Adapter" value={postgrad.adapterAddress} />
          {venue ? (
            <>
              <ContractAddressRow label="YES pool" value={venue.yesPool.poolId} />
              <ContractAddressRow label="NO pool" value={venue.noPool.poolId} />
            </>
          ) : null}
          <p className="mt-3 max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
            {venue?.live
              ? "Matched liquidity minted equal YES and NO outcome tokens, and trading continues on the bounded venue: swap outcome tokens through the pool manager or rest bounded maker orders with the order manager."
              : "Matched liquidity minted equal YES and NO outcome tokens in the postgrad market above; unmatched pre-graduation collateral refunds at its exact path cost."}
          </p>
        </div>
      ) : (
        <p className="mt-4 max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
          Matched liquidity created equal YES and NO claim tokens. The remaining
          pre-graduation collateral is marked for refund while post-graduation handoff
          is prepared.
        </p>
      )}
    </div>
  );
}

function ContractAddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-muted)] uppercase">
        {label}
      </span>
      <span className="font-mono text-[11px] break-all text-[var(--text-primary)]">
        {value}
      </span>
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
