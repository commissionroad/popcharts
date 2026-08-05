"use client";

import { PiggyBank, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useReviewCreditDeposit } from "@/integrations/contracts/hooks/use-review-credit";
import { formatTokenAmount } from "@/lib/format";

/**
 * The deposit presets, in native units ($1 = 1e18). Shared with the refusal
 * panel so a creator sees the same three amounts wherever they top up.
 */
export const DEPOSIT_PRESETS_WAD = [
  10n ** 18n,
  5n * 10n ** 18n,
  10n * 10n ** 18n,
] as const;

/** Focusable descendants, for the tab wrap-around. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Proactive review-credit top-up (ADR 0022, prepaid-credit amendment). The
 * refusal panel deposits too, but only once a submission has already been
 * blocked; this is the same deposit reachable before that happens, from the
 * credit card on the create page and the portfolio.
 *
 * It deliberately does not report the balance afterwards. A confirmed deposit
 * is not immediately spendable — the gate reads the server's indexed rows —
 * and the card that opened this already re-reads them off the beneficiary's
 * portfolio channel, which the indexer signals in the same transaction as the
 * deposit row. So the dialog's job ends at "confirmed", and the number
 * updates itself behind it.
 *
 * Rolled by hand rather than on `<dialog>`: jsdom implements neither
 * `showModal()` nor the backdrop, so a native dialog could not be tested at
 * the coverage this app enforces.
 */
export function ReviewCreditTopUpDialog({
  beneficiary,
  onClose,
  open,
}: {
  /** Account the credit belongs to — never defaulted to the payer. */
  beneficiary: `0x${string}` | null;
  onClose: () => void;
  open: boolean;
}) {
  const credit = useReviewCreditDeposit();
  const panelRef = useRef<HTMLDivElement>(null);
  // Restoring focus to whatever opened the dialog is the half of focus
  // management that keyboard users actually notice.
  const openerRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      // Wrap at both ends so Tab cannot walk out into the page behind.
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    openerRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    return () => openerRef.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  const busy = credit.status === "pending";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0/60%)] p-4"
      onClick={(event) => {
        // Backdrop only: a click that started inside the panel must not close.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-labelledby="review-credit-top-up-title"
        aria-modal="true"
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-tile)]"
        ref={panelRef}
        role="dialog"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PiggyBank color="var(--pc-cyan)" size={20} />
            <span
              className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--pc-cyan)] uppercase"
              id="review-credit-top-up-title"
            >
              Top up review credit
            </span>
          </div>
          <button
            aria-label="Close top-up dialog"
            className="focus-ring text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
          Credit is prepaid and non-refundable — each review of a question spends from
          it. Deposits credit{" "}
          {beneficiary ? (
            <span className="font-mono break-all text-[var(--text-secondary)]">
              {beneficiary}
            </span>
          ) : (
            "the connected wallet"
          )}
          .
        </p>

        <div className="flex gap-2">
          {DEPOSIT_PRESETS_WAD.map((amount) => (
            <Button
              className="flex-1"
              disabled={!credit.enabled || !beneficiary || busy}
              glow
              key={amount.toString()}
              // The button is disabled without a beneficiary, so the handler
              // can assume one.
              onClick={() => credit.deposit(beneficiary!, amount)}
              size="lg"
            >
              {`Deposit ${formatTokenAmount(amount)}`}
            </Button>
          ))}
        </div>

        {credit.error ? (
          <p className="text-[12.5px] leading-5 text-[var(--no)]" role="alert">
            {credit.error}
          </p>
        ) : null}

        <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
          {credit.status === "success"
            ? "Deposit confirmed — your balance updates once it's indexed."
            : busy
              ? "Confirm the deposit in your wallet…"
              : "One transaction — no signature beyond it."}
        </span>
      </div>
    </div>
  );
}
