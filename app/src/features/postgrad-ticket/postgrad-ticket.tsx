"use client";

import {
  ArrowLeftRight,
  Loader2,
  ShieldAlert,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  type Market,
  type MarketPostgradHandoff,
  marketSideLabel,
} from "@/domain/markets/types";
import { cn } from "@/lib/cn";

import { formatSwapStep } from "./postgrad-ticket-format";
import {
  CompletedSwapNotice,
  SwapQuotePreview,
  VenueBalancesPanel,
} from "./postgrad-ticket-panels";
import {
  usePostgradTicketState,
  venuePresetAmounts,
} from "./use-postgrad-ticket-state";

/**
 * Aside panel for a graduated market. When the bounded venue is live it
 * offers the postgrad trade ticket; before that it reports the honest
 * non-trading state (venue wiring in progress, or handoff not yet indexed).
 */
export function PostgradTradePanel({ market }: { market: Market }) {
  const venue = market.postgrad?.venue;

  if (venue?.live) {
    return <PostgradTicket market={market} />;
  }

  return <PostgradVenueStatusCard postgrad={market.postgrad} />;
}

/**
 * The post-graduation trade ticket for one market: outcome side and buy/sell
 * selection, amount entry, a live market-order quote, and wallet-signed swaps
 * against the bounded venue's router. Unlike pregrad receipts, these orders
 * are real fills that settle immediately. State and submission flows live in
 * usePostgradTicketState; this component is presentation.
 */
export function PostgradTicket({ market }: { market: Market }) {
  const {
    action,
    amount,
    amountFieldError,
    balances,
    canMintTestPusd,
    completedSwap,
    environment,
    isMinting,
    isSwapping,
    quote,
    quoteLoading,
    quoteWarning,
    side,
    submitError,
    swapAction,
    swapStep,
    walletConnected,
    mintTestPusd,
    selectAction,
    selectPresetAmount,
    selectSide,
    updateAmount,
  } = usePostgradTicketState(market);
  const sideColor = side === "yes" ? "var(--yes)" : "var(--no)";
  const yesLabel = marketSideLabel(market, "yes");
  const noLabel = marketSideLabel(market, "no");

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Trade outcome tokens
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            {environment.kind === "contract"
              ? "Wallet-signed market order on the bounded venue."
              : "Fixture-backed venue preview."}
          </p>
        </div>
        <span className="rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
          {environment.kind === "contract" ? "Devchain" : "Mock"}
        </span>
      </div>

      <SegmentedControl
        accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
        full
        onChange={selectSide}
        options={[
          { label: yesLabel, value: "yes" },
          { label: noLabel, value: "no" },
        ]}
        value={side}
      />

      <SegmentedControl
        full
        onChange={selectAction}
        options={[
          { label: "Buy", value: "buy" },
          { label: "Sell", value: "sell" },
        ]}
        size="sm"
        value={action}
      />

      <Field
        error={amountFieldError}
        id="venue-amount"
        label={action === "buy" ? "Collateral to spend" : "Tokens to sell"}
        mono
        onChange={(event) => updateAmount(event.target.value)}
        suffix={
          action === "buy" ? "pUSD" : `${side === "yes" ? yesLabel : noLabel} tok`
        }
        value={amount}
      />

      <div className="grid grid-cols-4 gap-2">
        {venuePresetAmounts.map((preset) => (
          <button
            className={cn(
              "focus-ring rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]",
              preset === amount ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]" : null
            )}
            key={preset}
            onClick={() => selectPresetAmount(preset)}
            type="button"
          >
            {preset}
          </button>
        ))}
      </div>

      {environment.kind === "contract" ? (
        <VenueBalancesPanel
          balances={balances}
          canMint={canMintTestPusd}
          isMinting={isMinting}
          noLabel={noLabel}
          onMint={mintTestPusd}
          walletConnected={walletConnected}
          yesLabel={yesLabel}
        />
      ) : null}

      <SwapQuotePreview
        quote={quote}
        quoteLoading={quoteLoading}
        sideColor={sideColor}
      />

      {quoteWarning ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] p-3 text-[12px] leading-5 text-[var(--status-graduating)]">
          {quoteWarning}
        </div>
      ) : null}

      {submitError ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{submitError}</span>
        </div>
      ) : null}

      {completedSwap ? (
        <CompletedSwapNotice
          noLabel={noLabel}
          swap={completedSwap}
          yesLabel={yesLabel}
        />
      ) : null}

      <Button
        className="w-full"
        disabled={swapAction.disabled}
        glow={false}
        leftIcon={
          isSwapping ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <ArrowLeftRight size={17} />
          )
        }
        onClick={swapAction.onClick}
        style={{
          background: sideColor,
          boxShadow: side === "yes" ? "var(--glow-lime)" : "var(--glow-magenta)",
        }}
      >
        {swapAction.label}
      </Button>

      {swapStep ? (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatSwapStep(swapStep)}
        </div>
      ) : null}

      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 shrink-0 text-[var(--text-muted)]" size={15} />
        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          Market orders settle immediately at the pool price, bounded by the
          venue&apos;s price band. Oversized orders stop at the band edge and return the
          unspent remainder.
        </p>
      </div>
    </section>
  );
}

/**
 * Status card for a graduated market whose venue is not tradable yet: says
 * where trading stands instead of offering the ticket.
 */
function PostgradVenueStatusCard({
  postgrad,
}: {
  postgrad: MarketPostgradHandoff | undefined;
}) {
  const status = postgrad ? "Venue wiring in progress" : "Handoff pending";
  const detail = postgrad
    ? "Matched liquidity settled into complete sets in the postgrad market; the bounded venue is not live yet."
    : "This market graduated, but its onchain handoff has not been indexed yet.";

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
        <TrendingUp size={16} /> Post-graduation trading
      </div>
      <div className="font-display text-xl font-black text-[var(--text-primary)]">
        {status}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        {detail}
      </p>
    </div>
  );
}
