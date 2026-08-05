"use client";

import type {
  MarketDraftBondShortfall,
  MarketDraftReviewCredit,
} from "@popcharts/api-client/models";
import { portfolioChannel } from "@popcharts/live-channels";
import { PiggyBank, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DEPOSIT_PRESETS_WAD } from "@/features/review-credit/review-credit-top-up-dialog";
import { useReviewCreditDeposit } from "@/integrations/contracts/hooks/use-review-credit";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { formatTokenAmount } from "@/lib/format";

import { ReviewRow } from "../create-market-panels/shared";

/** How long to wait for a confirmed deposit to appear in the indexed view. */
const INDEXING_POLL_TIMEOUT_MS = 30_000;
/**
 * Fallback cadence only: the deposit is announced by the change feed (the
 * indexer signals the beneficiary's portfolio channel in the same
 * transaction as the deposit row), and the signal triggers an immediate
 * re-check. This slow poll covers a dropped SSE connection.
 */
const INDEXING_FALLBACK_POLL_MS = 5_000;

/**
 * Shown when the review-credit meter refuses a submission (ADR 0022,
 * prepaid-credit amendment): the wallet's credit position with its run
 * counts, and $1 / $5 / $10 deposit presets. Credit is non-refundable —
 * the copy says so before the money moves, not after.
 *
 * A confirmed deposit is not yet spendable: the submission gate reads the
 * server's indexed rows, which lag the chain by a beat. After the transaction
 * confirms the panel polls the credit endpoint until the balance covers the
 * run, then resubmits via {@link onFunded} — the creator never retypes
 * anything.
 */
export function ReviewCreditPanel({
  beneficiary,
  fetchCredit,
  onDismiss,
  onFunded,
  shortfall,
}: {
  /** The draft's intended creator — the account the deposit credits. */
  beneficiary: `0x${string}` | null;
  /** Reads the beneficiary's indexed credit position; null when unavailable. */
  fetchCredit: (() => Promise<MarketDraftReviewCredit>) | null;
  onDismiss: () => void;
  onFunded: () => void;
  shortfall: MarketDraftBondShortfall;
}) {
  const credit = useReviewCreditDeposit();
  // Set asynchronously by the poll loop when the indexed view never catches
  // up; cleared when the creator starts another deposit. "Indexing" needs no
  // state of its own — it is derived from a confirmed write that has neither
  // funded nor stalled.
  const [stalled, setStalled] = useState(false);
  const notified = useRef(false);

  // Re-checks the indexed view on demand; installed by the effect below and
  // fired early by the change-feed signal so a live connection funds the
  // moment the deposit indexes instead of on the next fallback tick.
  const checkNowRef = useRef<(() => void) | null>(null);

  // One funded notification per refusal: once the deposit confirms, watch
  // the indexed view until the balance covers the run, then hand back to the
  // parent to resubmit. The change-feed signal is the primary wake-up; a
  // slow poll is the fallback for a dropped connection. Without a credit
  // reader (no wallet on the draft — the panel is not reachable that way,
  // but belt and braces) fund immediately and let the resubmit's own 402
  // re-open this panel.
  useEffect(() => {
    if (credit.status !== "success" || notified.current) {
      return;
    }

    if (!fetchCredit) {
      notified.current = true;
      onFunded();
      return;
    }

    let cancelled = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const check = async () => {
      if (cancelled || checking) {
        return;
      }
      checking = true;

      try {
        const position = await fetchCredit();

        if (
          !cancelled &&
          BigInt(position.availableWad) >= BigInt(shortfall.requiredWad)
        ) {
          if (!notified.current) {
            notified.current = true;
            onFunded();
          }
          return;
        }
      } catch {
        // A transient read failure is the same as "not indexed yet".
      } finally {
        checking = false;
      }

      if (cancelled) {
        return;
      }

      if (Date.now() - startedAt > INDEXING_POLL_TIMEOUT_MS) {
        // Setting state after an unmount is a silent no-op in React 18+,
        // so this needs no cancelled guard of its own.
        setStalled(true);
        return;
      }

      clearTimeout(timer);
      timer = setTimeout(() => void check(), INDEXING_FALLBACK_POLL_MS);
    };

    checkNowRef.current = () => void check();
    void check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      checkNowRef.current = null;
    };
  }, [credit.status, fetchCredit, onFunded, shortfall.requiredWad]);

  // The deposit's change-feed nudge (ADR 0021): the indexer records the
  // deposit row and signals portfolio:{beneficiary} in the same transaction,
  // so this fires exactly when the gate's view of the balance moves. The
  // signal carries no data — the handler re-reads the authoritative credit
  // endpoint. Outside the indexing phase the channel is null and this
  // subscribes to nothing.
  const indexingPhase = credit.status === "success" && !stalled;

  useLiveChannel(
    indexingPhase && beneficiary ? portfolioChannel(beneficiary) : null,
    () => checkNowRef.current?.()
  );

  const rate = BigInt(shortfall.requiredWad);
  const available = BigInt(shortfall.availableWad);
  const runsLeft = rate > 0n ? Number(available / rate) : 0;
  const indexing = indexingPhase;
  const busy = credit.status === "pending" || indexing;

  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--pc-amber)] bg-[var(--surface-card)] p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PiggyBank color="var(--pc-amber)" size={20} />
            <span className="font-mono text-[10px] font-bold tracking-[0.14em] text-[var(--pc-amber)] uppercase">
              Review credit needed
            </span>
          </div>
          <button
            aria-label="Dismiss credit prompt"
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
            label="Credit left"
            value={`${formatTokenAmount(available)} pUSD`}
          />
          <ReviewRow
            label="Price per review"
            value={`${formatTokenAmount(rate)} pUSD`}
          />
          <ReviewRow label="Reviews used" value={String(shortfall.runsUsed)} />
          <ReviewRow label="Reviews left" value={String(runsLeft)} />
        </div>
        <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
          Credit is prepaid and non-refundable — each review of a question spends{" "}
          {formatTokenAmount(rate)} pUSD from it.
        </p>
        {credit.error ? (
          <p className="text-[12.5px] leading-5 text-[var(--no)]" role="alert">
            {credit.error}
          </p>
        ) : null}
        {stalled ? (
          <p className="text-[12.5px] leading-5 text-[var(--no)]" role="alert">
            Your deposit confirmed but hasn&apos;t been indexed yet. It isn&apos;t lost
            — resubmit in a moment.
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        {DEPOSIT_PRESETS_WAD.map((amount) => (
          <Button
            className="flex-1"
            disabled={!credit.enabled || !beneficiary || busy}
            glow
            key={amount.toString()}
            onClick={() => {
              // The button is disabled without a beneficiary, so the click
              // handler can assume one.
              setStalled(false);
              credit.deposit(beneficiary!, amount);
            }}
            size="lg"
          >
            {`Deposit ${formatTokenAmount(amount)}`}
          </Button>
        ))}
      </div>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        {indexing
          ? "Deposit confirmed — waiting for it to be indexed…"
          : credit.status === "pending"
            ? "Confirm the deposit in your wallet…"
            : "One transaction — your draft resubmits automatically"}
      </span>
    </>
  );
}
