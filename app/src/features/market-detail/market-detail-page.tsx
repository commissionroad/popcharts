import { RECEIPTS_STREAM } from "@popcharts/live-channels";
import { ArrowLeft, BadgeCheck, Coins, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";

import { SmallMetric } from "@/components/ui/small-metric";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusPill } from "@/components/ui/status-pill";
import { isAwaitingResolution } from "@/domain/markets/status";
import { type Market, marketSideLabel, type PricePoint } from "@/domain/markets/types";
import { OrderBookCard } from "@/features/order-book/order-book-card";
import { OpenOrdersPanel } from "@/features/postgrad-ticket/open-orders-panel";
import { PostgradTradePanel } from "@/features/postgrad-ticket/postgrad-ticket";
import { ReceiptTicket } from "@/features/receipt-ticket/receipt-ticket";
import { formatB, formatDateTime, formatUsdCompact } from "@/lib/format";

import { AiReviewCard } from "./ai-review-card";
import { AiReviewProgressCard } from "./ai-review-progress-card";
import { AiReviewRefresh } from "./ai-review-refresh";
import { ClaimWinningsPanel } from "./claim-winnings-panel";
import { GraduateMarketButton } from "./graduate-market-button";
import { MarketAboutCard } from "./market-about-card";
import { MarketDisputePanel } from "./market-dispute-panel";
import { MarketLivePrice } from "./market-live-price";
import { MarketLiveStats } from "./market-live-stats";
import { MarketPositionPanel } from "./market-position-panel";

export function MarketDetailPage({
  market,
  pricePath,
  venueSeedStreams,
}: {
  market: Market;
  /** Whole-life history from the unified read (repo ADR 0025), when it loaded. */
  pricePath?: PricePoint[];
  /** Last live-tick ordinal per venue stream, from the same read. */
  venueSeedStreams?: Record<string, number>;
}) {
  // Fallback for fixture-backed markets and a failed history read: the
  // market's synthetic YES path, with NO as its complement — but only while
  // the market is pregrad-shaped. A graduated or resolved market's synthetic
  // path ends at a venue or terminal price, so dressing it up as an LMSR
  // curve would invent history and misstate NO (Codex P4 review finding);
  // those markets render the chart's honest empty state instead.
  const chartPoints =
    pricePath ??
    (market.postgrad
      ? []
      : market.pricePath.map((cents) => ({
          noCents: 100 - cents,
          yesCents: cents,
        })));
  // Once a market graduates the receipt book is history: the page leads with
  // the graduation outcome and drops the pre-graduation progress/trading UI.
  // This holds for the whole dispute window too — a market in
  // `resolution_pending` or `disputed` has graduated and its outcome tokens
  // are still trading, so it keeps the order book and the postgrad ticket.
  const isGraduated = isAwaitingResolution(market.status);
  // Once it resolves, trading is history too: the page leads with the outcome
  // and the aside becomes the claim surface instead of a trade ticket.
  const isResolved = market.status === "resolved";
  // A postgrad draw (MarketCancelled after graduation, marked by its terminal
  // resolution event) settles at half value per side. A pregrad admin-cancel
  // shares the `cancelled` status but has no resolution event — it stays on
  // the receipt view, where the refund claim lives.
  const isDraw =
    market.status === "cancelled" && market.resolution?.kind === "cancelled";
  const settled = isGraduated || isResolved || isDraw;
  // The graduate button is the manual fallback for a market that earned
  // graduation but was not yet picked up by the keeper — it never forces
  // liquidity, so it only shows once the threshold is met.
  const canRequestGraduation =
    market.status === "bootstrap" &&
    market.graduationTargetUsd > 0 &&
    market.matchedUsd >= market.graduationTargetUsd &&
    isApiBackedMarket(market);
  const reviewProgress =
    market.aiReviewProgress ??
    (!market.aiReview && market.status === "under_review"
      ? { phase: "awaiting_queue" as const, status: "pending" as const }
      : undefined);

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
            </div>
          </div>

          <h1 className="font-display max-w-3xl text-3xl leading-tight font-black sm:text-4xl">
            {market.question}
          </h1>

          {/* The live price surface (headline + chart). It owns the market's
              channel subscription: a pregrad trade's price tick appends a point
              in place, and every other signal — a lifecycle change, a reset, or
              a gap in the tick sequence — refetches the whole page. The settled
              summary sits between the headline and the chart, so it is passed
              through as the island's children. Keyed on the market id so a
              client navigation between two markets whose receipt counts happen
              to match still resets the appended ticks instead of reusing them. */}
          <MarketLivePrice
            key={market.id}
            chartHeading={chartHeading({ market, points: chartPoints, settled })}
            {...(market.postgrad ? { graduatedAt: market.postgrad.finalizedAt } : {})}
            marketAppId={market.id}
            noLabel={marketSideLabel(market, "no")}
            noPriceCents={market.noPriceCents}
            points={chartPoints}
            seedStreams={{
              [RECEIPTS_STREAM]: market.receiptCount,
              ...(venueSeedStreams ?? {}),
            }}
            yesLabel={marketSideLabel(market, "yes")}
            yesPriceCents={market.yesPriceCents}
          >
            {isResolved || isDraw ? <ResolvedMarketSummary market={market} /> : null}
            {isGraduated ? <GraduatedMarketSummary market={market} /> : null}
          </MarketLivePrice>

          {isGraduated ? <OrderBookCard market={market} /> : null}

          {settled ? null : (
            <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
              {/* Graduation bar + volume + receipts move live off the trade
                  ticks' post-trade totals; b is static curve config, passed
                  through as the island's server-rendered child. */}
              <MarketLiveStats market={market}>
                <SmallMetric label="b" value={formatB(market.b)} />
              </MarketLiveStats>
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
          {!market.aiReview && reviewProgress ? (
            <AiReviewProgressCard progress={reviewProgress} />
          ) : null}
          {!market.aiReview && reviewProgress?.status === "pending" ? (
            <AiReviewRefresh />
          ) : null}
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <MarketPositionPanel market={market} />
          {isResolved || isDraw ? (
            <>
              <ClaimWinningsPanel market={market} />
              {/* Tokens resting in ask orders cannot redeem until the order
                  is cancelled, so the cancel surface stays available. */}
              <OpenOrdersPanel market={market} orderType="market" refreshKey={0} />
            </>
          ) : isGraduated ? (
            <>
              {/* The dispute window opens while the market is still indexed as
                  graduated (the pending/disputed statuses are not projected
                  yet), so this panel reads the postgrad contract directly and
                  renders nothing outside an open window. */}
              <MarketDisputePanel market={market} />
              <PostgradTradePanel market={market} />
            </>
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

/**
 * What the chart is actually showing, which depends on how much of the
 * market's life it covers. A graduated market whose venue has traded spans
 * both mechanisms, so naming either one would be wrong; before graduation the
 * curve is purely the virtual LMSR. A settled market with no venue prices —
 * graduated but not yet traded, or never indexed — really is showing only its
 * pre-graduation history, and still says so.
 */
function chartHeading({
  market,
  points,
  settled,
}: {
  market: Market;
  points: PricePoint[];
  settled: boolean;
}) {
  if (!settled) {
    return "Virtual LMSR - implied probability";
  }

  // The unified path carries no phase marker, so "does the curve extend past
  // the handoff" is answered from the graduation annotation: any point at or
  // after finalizedAt means the venue half is on screen.
  const graduatedAtMs = market.postgrad
    ? Date.parse(market.postgrad.finalizedAt)
    : Number.NaN;
  const spansVenue =
    Number.isFinite(graduatedAtMs) &&
    points.some(
      (point) => point.at !== undefined && Date.parse(point.at) >= graduatedAtMs
    );

  return spansVenue ? "Price history" : "Pre-graduation price history";
}

/**
 * The headline outcome of a settled market: which side won (or that the
 * market cancelled to a draw), when, and what that means for holders. Tokens
 * redeem from the claim panel in the aside; a resolution without a recorded
 * winning side (not yet indexed) degrades to the resolution date alone
 * rather than guessing a winner.
 */
function ResolvedMarketSummary({ market }: { market: Market }) {
  const isDraw = market.resolution?.kind === "cancelled";
  const winningSide = market.resolution?.winningSide;
  const resolvedAt = market.resolution?.resolvedAt;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--status-graduated)] bg-[var(--surface-raised)] p-5">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[var(--status-graduated)] uppercase">
        <BadgeCheck size={16} />
        {isDraw
          ? "Cancelled - draw"
          : winningSide
            ? `Resolved - ${marketSideLabel(market, winningSide)} wins`
            : "Resolved"}
      </div>
      <p className="max-w-2xl text-[12px] leading-5 text-[var(--text-secondary)]">
        {isDraw
          ? `This market was cancelled after graduation, so ${marketSideLabel(
              market,
              "yes"
            )} and ${marketSideLabel(market, "no")} tokens both redeem at half value.`
          : winningSide
            ? `Winning ${marketSideLabel(market, winningSide)} tokens redeem 1:1 for collateral; ${marketSideLabel(
                market,
                winningSide === "yes" ? "no" : "yes"
              )} tokens finished out of the money.`
            : "This market has resolved on-chain."}
        {resolvedAt ? ` Settled ${formatDateTime(resolvedAt)}.` : ""}
      </p>
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

function isApiBackedMarket(market: Market) {
  return market.chainId !== undefined && market.id.includes(":");
}
