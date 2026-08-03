"use client";

import type { MarketDraftBondShortfall } from "@popcharts/api-client/models";
import { PiggyBank, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useReviewBond } from "@/integrations/contracts/hooks/use-review-bond";
import { formatTokenAmount } from "@/lib/format";

import { ReviewRow } from "../create-market-panels/shared";

/**
 * The native deposit that clears a shortfall: enough to reach the $5
 * standing-bond floor and cover the queued charge, whichever is larger.
 */
export function suggestedDepositWad(shortfall: MarketDraftBondShortfall): bigint {
  const standingGap =
    BigInt(shortfall.minimumStandingBondWad) - BigInt(shortfall.standingBondWad);
  const chargeGap = BigInt(shortfall.requiredWad) - BigInt(shortfall.availableWad);
  const largest = standingGap > chargeGap ? standingGap : chargeGap;

  return largest > 0n ? largest : 0n;
}

/**
 * Shown when the review-bond meter refuses a submission (ADR 0022 §3): the
 * shortfall figures, a one-click deposit sized by {@link suggestedDepositWad},
 * and an automatic resubmit once the deposit confirms — the creator never
 * retypes anything. The bond is refundable; copy says so.
 */
export function BondShortfallPanel({
  onDismiss,
  onFunded,
  shortfall,
}: {
  onDismiss: () => void;
  onFunded: () => void;
  shortfall: MarketDraftBondShortfall;
}) {
  const bond = useReviewBond();
  const notified = useRef(false);

  // One funded notification per confirmed deposit: the parent resubmits, the
  // meter re-reads the chain, and this panel unmounts when it passes.
  useEffect(() => {
    if (bond.status === "success" && !notified.current) {
      notified.current = true;
      onFunded();
    }
  }, [bond.status, onFunded]);

  const deposit = suggestedDepositWad(shortfall);

  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--pc-amber)] bg-[var(--surface-card)] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PiggyBank color="var(--pc-amber)" size={20} />
            <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--pc-amber)] uppercase">
              Review bond needed
            </span>
          </div>
          <button
            aria-label="Dismiss bond prompt"
            className="focus-ring text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={onDismiss}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          {shortfall.message}
        </p>
        <div className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
          <ReviewRow
            label="Bonded"
            value={`${formatTokenAmount(BigInt(shortfall.standingBondWad))} pUSD`}
          />
          <ReviewRow
            label="Available"
            value={`${formatTokenAmount(BigInt(shortfall.availableWad))} pUSD`}
          />
          <ReviewRow
            label="This submission"
            value={`${formatTokenAmount(BigInt(shortfall.requiredWad))} pUSD`}
          />
        </div>
        <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
          The bond is a prepaid, refundable balance — reviews meter against it, and you
          can withdraw the unused remainder anytime.
        </p>
        {bond.error ? (
          <p className="text-[12.5px] leading-5 text-[var(--no)]" role="alert">
            {bond.error}
          </p>
        ) : null}
      </div>
      <Button
        disabled={!bond.enabled || bond.status === "pending" || deposit === 0n}
        glow
        leftIcon={<PiggyBank size={16} />}
        onClick={() => bond.deposit(deposit)}
        size="lg"
      >
        {bond.status === "pending"
          ? "Depositing…"
          : `Deposit ${formatTokenAmount(deposit)} pUSD & resubmit`}
      </Button>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        One transaction — your draft resubmits automatically
      </span>
    </>
  );
}
