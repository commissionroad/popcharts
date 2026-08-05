import type { MarketDraftReviewCredit } from "@popcharts/api-client/models";
import { CirclePlus, PiggyBank } from "lucide-react";

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
  // Nothing to meter, for any of three reasons: the position has not been read
  // yet; the stack runs no vault and submission is ungated (the API's
  // metered=false); or the rate is zero, which the server treats as "reviews
  // are free" and reports as runsRemaining: 0 while still letting every
  // submission through. That last one is why the rate is checked rather than
  // trusted — a free stack would otherwise render "Out of credit" in red and
  // read as a blocker that does not exist.
  if (!credit?.metered || BigInt(credit.rateWad) === 0n) {
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
      <div className="flex items-start justify-between gap-3">
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

        {onTopUp ? (
          // Matches the app-nav icon-button idiom: quiet until pointed at,
          // then it takes the accent. `title` carries the same words as the
          // aria-label so the hover explains the glyph.
          <button
            aria-label="Top up review credit"
            className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:border-[var(--pc-cyan)] hover:text-[var(--pc-cyan)]"
            onClick={onTopUp}
            title="Top up review credit"
            type="button"
          >
            <CirclePlus aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>

      <p className="text-[12.5px] leading-5 text-[var(--text-muted)]">
        {formatTokenAmount(BigInt(credit.availableWad))} pUSD left ·{" "}
        {formatTokenAmount(BigInt(credit.rateWad))} pUSD per review
      </p>
    </div>
  );
}
