"use client";

import { Loader2, ReceiptText, ShieldAlert, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { type Market, marketSideLabel } from "@/domain/markets/types";
import { cn } from "@/lib/cn";

import { getMaxPresetAmount } from "./receipt-action";
import { formatPlacementStep, formatPresetAmount } from "./receipt-ticket-format";
import {
  CollateralBalancePanel,
  PlacedReceiptNotice,
  QuotePreview,
} from "./receipt-ticket-panels";
import { presetAmounts, useReceiptTicketState } from "./use-receipt-ticket-state";

const marketStatusLabels: Record<Market["status"], string> = {
  under_review: "under review",
  bootstrap: "bootstrap",
  cancelled: "cancelled",
  graduated: "graduated",
  graduating: "graduating",
  refunded: "refunded",
  rejected: "rejected",
  resolved: "resolved",
};

/**
 * The pre-graduation trade ticket for one market: side and budget entry, a
 * live quote preview, and receipt placement against the devchain
 * PregradManager (with balance and market-existence checks) or the mock
 * environment. Placed receipts are priced intents, not fills. State and
 * submission flows live in useReceiptTicketState; this component is
 * presentation.
 */
export function ReceiptTicket({ market }: { market: Market }) {
  const {
    amount,
    amountFieldError,
    balanceUsd,
    contractMarketMissing,
    contractStatus,
    environment,
    isPlacing,
    placedReceipt,
    placementStep,
    quote,
    receiptAction,
    side,
    submitError,
    walletConnected,
    selectPresetAmount,
    selectSide,
    updateAmount,
  } = useReceiptTicketState(market);
  const sideColor = side === "yes" ? "var(--yes)" : "var(--no)";

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Place a receipt
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
            {environment.kind === "contract"
              ? "Wallet-signed pre-graduation intent."
              : "Fixture-backed trading preview."}
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
          { label: marketSideLabel(market, "yes"), value: "yes" },
          { label: marketSideLabel(market, "no"), value: "no" },
        ]}
        value={side}
      />

      <Field
        error={amountFieldError}
        id="receipt-amount"
        label="Collateral budget"
        mono
        onChange={(event) => updateAmount(event.target.value)}
        suffix="pUSD"
        value={amount}
      />

      <div className="grid grid-cols-4 gap-2">
        {presetAmounts.map((preset) => {
          const presetAmount =
            preset === "Max"
              ? formatPresetAmount(getMaxPresetAmount(balanceUsd))
              : preset;

          return (
            <button
              className={cn(
                "focus-ring rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-2 font-mono text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)]",
                presetAmount === amount
                  ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]"
                  : null
              )}
              key={preset}
              onClick={() => selectPresetAmount(preset)}
              type="button"
            >
              {preset}
            </button>
          );
        })}
      </div>

      {environment.kind === "contract" ? (
        <CollateralBalancePanel
          balanceUsd={balanceUsd}
          error={contractStatus.error}
          isLoading={contractStatus.loading}
          walletConnected={walletConnected}
        />
      ) : null}

      <QuotePreview quote={quote} sideColor={sideColor} />

      {contractMarketMissing ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>
            This market is not on the current local PregradManager. Create a new market,
            then trade that fresh market.
          </span>
        </div>
      ) : null}

      {submitError ? (
        <div className="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--no-bg)] p-3 text-[12px] leading-5 text-[var(--no)]">
          <TriangleAlert className="mt-0.5 shrink-0" size={14} />
          <span>{submitError}</span>
        </div>
      ) : null}

      {placedReceipt ? <PlacedReceiptNotice receipt={placedReceipt} /> : null}

      {market.status !== "bootstrap" ? (
        <div className="rounded-[var(--radius-sm)] border border-[var(--status-graduating)] bg-[var(--pc-amber-wash)] p-3 text-[12px] leading-5 text-[var(--status-graduating)]">
          This receipt book is locked because the market is{" "}
          {marketStatusLabels[market.status]}.
        </div>
      ) : null}

      <Button
        className="w-full"
        disabled={receiptAction.disabled}
        glow={false}
        leftIcon={
          isPlacing ? (
            <Loader2 className="animate-spin" size={17} />
          ) : (
            <ReceiptText size={17} />
          )
        }
        onClick={receiptAction.onClick}
        style={{
          background: sideColor,
          boxShadow: side === "yes" ? "var(--glow-lime)" : "var(--glow-magenta)",
        }}
      >
        {receiptAction.label}
      </Button>

      {placementStep ? (
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatPlacementStep(placementStep)}
        </div>
      ) : null}

      <div className="flex gap-2.5">
        <ShieldAlert className="mt-0.5 shrink-0 text-[var(--text-muted)]" size={15} />
        <p className="text-[11.5px] leading-5 text-[var(--text-muted)]">
          Not a guaranteed fill. Clears at graduation; worst case is a full refund at
          your exact path cost.
        </p>
      </div>
    </section>
  );
}
