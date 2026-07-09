"use client";

import {
  ArrowLeftRight,
  ClipboardList,
  Loader2,
  ShieldAlert,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  type Market,
  type MarketPostgradHandoff,
  marketSideLabel,
} from "@/domain/markets/types";
import { cn } from "@/lib/cn";

import { OpenOrdersPanel } from "./open-orders-panel";
import { formatLimitOrderStep, formatSwapStep } from "./postgrad-ticket-format";
import {
  CompletedLimitOrderNotice,
  CompletedSwapNotice,
  LimitOrderPreview,
  SwapQuotePreview,
  VenueBalancesPanel,
} from "./postgrad-ticket-panels";
import { useLimitOrderState } from "./use-limit-order-state";
import {
  usePostgradTicketState,
  venuePresetAmounts,
} from "./use-postgrad-ticket-state";

/** The two order types the postgrad ticket can compose. */
export type VenueOrderType = "limit" | "market";

/**
 * Aside panel for a graduated market. When the bounded venue is live it
 * offers the postgrad trade ticket (market and limit orders) plus the
 * wallet's open resting orders; before that it reports the honest
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
 * The post-graduation trade ticket for one market: a Market | Limit order
 * type toggle over the two ticket bodies, plus the open-orders panel
 * underneath. Market orders fill immediately against the pool; limit orders
 * rest on the order manager's book until the price crosses them.
 */
export function PostgradTicket({ market }: { market: Market }) {
  const [orderType, setOrderType] = useState<VenueOrderType>("market");
  // Bumped when a limit order confirms so the open-orders panel re-reads
  // without waiting for its next poll.
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      {orderType === "market" ? (
        <MarketOrderTicket
          market={market}
          onOrderTypeChange={setOrderType}
          orderType={orderType}
        />
      ) : (
        <LimitOrderTicket
          market={market}
          onOrderPlaced={() => setOrdersRefreshKey((value) => value + 1)}
          onOrderTypeChange={setOrderType}
          orderType={orderType}
        />
      )}
      <OpenOrdersPanel
        market={market}
        orderType={orderType}
        refreshKey={ordersRefreshKey}
      />
    </div>
  );
}

/**
 * Market-order body: outcome side and buy/sell selection, amount entry, a
 * live market-order quote, and wallet-signed swaps against the bounded
 * venue's router. Unlike pregrad receipts, these orders are real fills that
 * settle immediately. State and submission flows live in
 * usePostgradTicketState; this component is presentation.
 */
function MarketOrderTicket({
  market,
  onOrderTypeChange,
  orderType,
}: {
  market: Market;
  onOrderTypeChange: (orderType: VenueOrderType) => void;
  orderType: VenueOrderType;
}) {
  const {
    action,
    amount,
    amountFieldError,
    balances,
    completedSwap,
    environment,
    isSwapping,
    quote,
    quoteLoading,
    quoteWarning,
    side,
    submitError,
    swapAction,
    swapStep,
    walletConnected,
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
      <TicketHeader environmentKind={environment.kind} />

      <TicketSelectors
        action={action}
        noLabel={noLabel}
        onActionChange={selectAction}
        onOrderTypeChange={onOrderTypeChange}
        onSideChange={selectSide}
        orderType={orderType}
        side={side}
        yesLabel={yesLabel}
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
          noLabel={noLabel}
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

      {submitError ? <TicketErrorNotice message={submitError} /> : null}

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
 * Limit-order body: outcome side and buy/sell selection, a whole-cent limit
 * price and a size in outcome tokens, the deposit preview, and the
 * approve-and-create flow against the venue's order manager. Placed orders
 * rest on the book until the market crosses their price. State and
 * submission flows live in useLimitOrderState; this component is
 * presentation.
 */
function LimitOrderTicket({
  market,
  onOrderPlaced,
  onOrderTypeChange,
  orderType,
}: {
  market: Market;
  onOrderPlaced: () => void;
  onOrderTypeChange: (orderType: VenueOrderType) => void;
  orderType: VenueOrderType;
}) {
  const {
    action,
    completedOrder,
    environment,
    isPlacing,
    orderStep,
    placeAction,
    priceFieldError,
    priceInput,
    quote,
    side,
    sizeFieldError,
    sizeInput,
    submitError,
    selectAction,
    selectSide,
    updatePrice,
    updateSize,
  } = useLimitOrderState(market, { onOrderPlaced });
  const sideColor = side === "yes" ? "var(--yes)" : "var(--no)";
  const yesLabel = marketSideLabel(market, "yes");
  const noLabel = marketSideLabel(market, "no");

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <TicketHeader environmentKind={environment.kind} />

      <TicketSelectors
        action={action}
        noLabel={noLabel}
        onActionChange={selectAction}
        onOrderTypeChange={onOrderTypeChange}
        onSideChange={selectSide}
        orderType={orderType}
        side={side}
        yesLabel={yesLabel}
      />

      <Field
        error={priceFieldError}
        id="venue-limit-price"
        label="Limit price"
        mono
        onChange={(event) => updatePrice(event.target.value)}
        suffix="c"
        value={priceInput}
      />

      <Field
        error={sizeFieldError}
        id="venue-limit-size"
        label={action === "buy" ? "Tokens to buy" : "Tokens to sell"}
        mono
        onChange={(event) => updateSize(event.target.value)}
        suffix={`${side === "yes" ? yesLabel : noLabel} tok`}
        value={sizeInput}
      />

      <LimitOrderPreview quote={quote} sideColor={sideColor} />

      {submitError ? <TicketErrorNotice message={submitError} /> : null}

      {completedOrder ? (
        <CompletedLimitOrderNotice
          noLabel={noLabel}
          order={completedOrder}
          yesLabel={yesLabel}
        />
      ) : null}

      <Button
        className="w-full"
        disabled={placeAction.disabled}
        glow={false}
        leftIcon={
          isPlacing ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <ClipboardList size={17} />
          )
        }
        onClick={placeAction.onClick}
        style={{
          background: sideColor,
          boxShadow: side === "yes" ? "var(--glow-lime)" : "var(--glow-magenta)",
        }}
      >
        {placeAction.label}
      </Button>

      {orderStep ? (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatLimitOrderStep(orderStep)}
        </div>
      ) : null}

      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 shrink-0 text-[var(--text-muted)]" size={15} />
        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          Limit orders rest on the venue&apos;s book until the market crosses your
          price, and can partially fill. Crossed orders can settle a few seconds after
          the price reaches them. Cancel any time to reclaim the unfilled deposit.
        </p>
      </div>
    </section>
  );
}

function TicketHeader({ environmentKind }: { environmentKind: "contract" | "mock" }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          Trade outcome tokens
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
          {environmentKind === "contract"
            ? "Wallet-signed order on the bounded venue."
            : "Fixture-backed venue preview."}
        </p>
      </div>
      <span className="rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
        {environmentKind === "contract" ? "Devchain" : "Mock"}
      </span>
    </div>
  );
}

/**
 * The ticket's shared selector stack: outcome side, then buy/sell next to
 * the Market | Limit order-type toggle.
 */
function TicketSelectors({
  action,
  noLabel,
  onActionChange,
  onOrderTypeChange,
  onSideChange,
  orderType,
  side,
  yesLabel,
}: {
  action: string;
  noLabel: string;
  onActionChange: (value: string) => void;
  onOrderTypeChange: (orderType: VenueOrderType) => void;
  onSideChange: (value: string) => void;
  orderType: VenueOrderType;
  side: string;
  yesLabel: string;
}) {
  return (
    <>
      <SegmentedControl
        accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
        full
        onChange={onSideChange}
        options={[
          { label: yesLabel, value: "yes" },
          { label: noLabel, value: "no" },
        ]}
        value={side}
      />

      <div className="grid grid-cols-2 gap-2">
        <SegmentedControl
          full
          onChange={onActionChange}
          options={[
            { label: "Buy", value: "buy" },
            { label: "Sell", value: "sell" },
          ]}
          size="sm"
          value={action}
        />
        <SegmentedControl
          full
          onChange={(value) =>
            onOrderTypeChange(value === "limit" ? "limit" : "market")
          }
          options={[
            { label: "Market", value: "market" },
            { label: "Limit", value: "limit" },
          ]}
          size="sm"
          value={orderType}
        />
      </div>
    </>
  );
}

function TicketErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
      <TriangleAlert className="mt-0.5 shrink-0" size={14} />
      <span>{message}</span>
    </div>
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
