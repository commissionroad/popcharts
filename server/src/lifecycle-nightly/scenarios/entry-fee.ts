import { setEntryFeeRateAsOwner } from "../operator";
import { ENTRY_FEE_RATE_WAD, readEntryFeeRateWad } from "./entry-fee-checks";
import { runGraduationPath } from "./entry-fee-graduation-path";
import { runRefundPath } from "./entry-fee-refund-path";
import type { Scenario } from "../report";

/**
 * ADR 0014 P4a: the pre-graduation entry fee, run ARMED. The rate ships
 * disarmed, so every other scenario exercises the zero-fee path; this one
 * arms 1% as the owner (the production arming call), places receipts, and
 * asserts the fee paper trail in `receipt_entry_fee_events` with exact
 * integer amounts re-derived from each receipt's own facts.
 *
 * Two markets, one per settlement path (sibling modules):
 *
 * - Refund path (entry-fee-refund-path.ts): a below-threshold market passes
 *   its deadline, the keeper opens refunds, and each claim returns escrow
 *   plus the fee in full — `collected` and `refunded` rows mirror each other
 *   and nothing is earned (the fee is a success fee).
 * - Graduation path (entry-fee-graduation-path.ts): partial-clearing's split
 *   book, so the graduated claims split each fee pro rata: `earned` on
 *   retained cost, `refunded` on refunded cost. The live rate is zeroed
 *   BEFORE those claims, so exact amounts also prove settlement pays the fee
 *   stamped on the receipt at placement, never one derived from the live
 *   rate.
 *
 * The rate is global to the manager, so the scenario brackets itself: the
 * pre-scenario rate is read up front with a plain view call, the arming
 * write happens inside the try, and the finally restores the pre-read rate
 * unconditionally — a partially-failed arming step can therefore never leak
 * an armed rate into later scenarios. Scenarios run strictly sequentially,
 * which is what makes a global knob safe to borrow.
 */
export const entryFee: Scenario = {
  name: "entry-fee",
  run: async ({ step }) => {
    // Plain read, no write: the restore below must know the pre-scenario
    // rate even when the arming write itself fails mid-step.
    const previousRateWad = await step("read the pre-scenario fee rate", () =>
      readEntryFeeRateWad(),
    );

    try {
      await step("arm the entry fee at 1% as owner", async () => {
        await setEntryFeeRateAsOwner(ENTRY_FEE_RATE_WAD);
      });

      await runRefundPath(step);
      await runGraduationPath(step);
    } finally {
      // Unconditional restore of the pre-read rate. On the success path the
      // graduation path has already zeroed the live rate, so this hands the
      // stack default back; on any failed step — including a partial arming
      // — it is what keeps an armed rate from leaking into later scenarios.
      await setEntryFeeRateAsOwner(previousRateWad);
    }
  },
};
