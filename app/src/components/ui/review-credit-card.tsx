import type { MarketDraftReviewCredit } from "@popcharts/api-client/models";
import { PiggyBank } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/format";

/**
 * At or below this many remaining reviews the card warns instead of just
 * reporting. Three is one full draft iteration plus a spare: enough runway to
 * top up deliberately rather than mid-submission.
 */
export const LOW_CREDIT_RUNS = 3;

/**
 * A creator's prepaid review-credit position (ADR 0022, prepaid-credit
 * amendment), sized to sit in the create page's aside and in the portfolio's
 * metric row. It reports the balance *before* a submission is refused — the
 * meter is otherwise invisible until it says no.
 *
 * It reads the same indexed position the submission gate reads, so what it
 * shows is what the gate will decide on. It deliberately renders nothing when
 * the credit is unknown or unmetered rather than showing a zero: an absent
 * balance and an empty one lead to opposite actions.
 */
export function ReviewCreditCard({
  credit,
  onTopUp,
}: {
  /** The wallet's indexed credit; null when unknown (no wallet, or loading). */
  credit: MarketDraftReviewCredit | null;
  /** Offers a top-up action. Omitted where the caller cannot service one. */
  onTopUp?: () => void;
}) {
  // Nothing to meter: either the position has not been read yet, or the stack
  // runs no vault and submission is ungated (the API's metered=false). A card
  // reading "0 reviews left" on an ungated stack would be a lie that reads as
  // a blocker.
  if (!credit?.metered) {
    return null;
  }

  // The generated wire model types the run counts as `string | number` (an
  // OpenAPI integer-serialization artifact), so coerce before comparing —
  // "0" <= 3 and 0 <= 3 must not disagree.
  const runsLeft = Number(credit.runsRemaining);
  const tone =
    runsLeft === 0
      ? "var(--danger)"
      : runsLeft <= LOW_CREDIT_RUNS
        ? "var(--pc-amber)"
        : "var(--pc-cyan)";

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-card)] p-4">
      <div className="flex items-center gap-3.5">
        <div style={{ color: tone }}>
          <PiggyBank aria-hidden="true" size={20} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            Review credit
          </div>
          <div
            className="font-display tabular mt-1 text-[22px] font-black"
            style={{ color: tone }}
          >
            {runsLeft === 0
              ? "Out of credit"
              : `${runsLeft.toLocaleString("en-US")} ${runsLeft === 1 ? "review" : "reviews"} left`}
          </div>
        </div>
      </div>

      <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
        {formatTokenAmount(BigInt(credit.availableWad))} pUSD left ·{" "}
        {formatTokenAmount(BigInt(credit.rateWad))} pUSD per review
      </p>

      {onTopUp ? (
        <Button onClick={onTopUp} size="sm" variant="secondary">
          Top up credit
        </Button>
      ) : null}
    </div>
  );
}
