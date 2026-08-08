import {
  MARKET_STATUS,
  mockCollateralAbi,
  pregradManagerAbi,
  SIDE_NO,
  SIDE_YES,
  WAD,
} from "@popcharts/protocol";
import { parseUnits, type Address } from "viem";

import { schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { jumpChainTimeTo } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import {
  assertChainStatus,
  waitForApiStatus,
  waitForIndexedRows,
} from "../market-checks";
import { setEntryFeeRateAsOwner } from "../operator";
import {
  assertMarketPaperTrail,
  assertMarketPaperTrailEventually,
} from "../paper-trail";
import {
  claimRefundedReceipt,
  placeGraduationLiquidity,
  placeReceipt,
} from "../pregrad-trading";
import {
  SCENARIO_ACCOUNTS,
  collateralAddress,
  pregradManagerAddress,
  publicClient,
} from "../stack";
import { startService, stopService } from "../stack-control";
import type { Scenario, ScenarioContext } from "../report";

/**
 * ADR 0014 P4a: the pre-graduation entry fee, run ARMED. The rate ships
 * disarmed, so every other scenario exercises the zero-fee path; this one
 * arms 1% as the owner (the production arming call), places receipts, and
 * asserts the fee paper trail in `receipt_entry_fee_events` with exact
 * integer amounts re-derived from each receipt's own facts.
 *
 * Two markets, one per settlement path:
 *
 * - Refund path: a below-threshold market passes its deadline, the keeper
 *   opens refunds, and each claim returns escrow plus the fee in full —
 *   `collected` and `refunded` rows mirror each other and nothing is earned
 *   (the fee is a success fee).
 * - Graduation path: partial-clearing's split book (balanced to threshold
 *   plus a one-sided YES excess, keeper paused while it assembles) so the
 *   graduated claims split each fee pro rata: `earned` on retained cost,
 *   `refunded` on refunded cost. The fee is disarmed again BEFORE those
 *   claims run, so exact amounts also prove settlement pays the fee stamped
 *   on the receipt at placement, never one derived from the live rate.
 *
 * The rate is global to the manager, so the scenario brackets itself:
 * arm first, hand the replaced rate back in a finally. Scenarios run
 * strictly sequentially, which is what makes a global knob safe to borrow.
 */

/** 1% in WAD (1e16) — well under the contract's 10% hard cap. */
const ENTRY_FEE_RATE_WAD = WAD / 100n;

export const entryFee: Scenario = {
  name: "entry-fee",
  run: async ({ step }) => {
    const previousRateWad = await step("arm the entry fee at 1% as owner", () =>
      setEntryFeeRateAsOwner(ENTRY_FEE_RATE_WAD),
    );

    try {
      await runRefundPath(step);
      await runGraduationPath(step, previousRateWad);
    } finally {
      // Idempotent backstop: the graduation path hands the rate back before
      // its claims, so on the success path this re-sets the same value — but
      // on a failed step it is what keeps the armed rate from leaking into
      // later scenarios' placements.
      await setEntryFeeRateAsOwner(previousRateWad);
    }
  },
};

/**
 * Place → deadline → refund. Every fee comes home: refunds are 101% of
 * cost, the fee escrow drains to zero, and the earned pot never moves.
 */
async function runRefundPath(step: ScenarioContext["step"]): Promise<void> {
  const market = await step("create the refund-path market", () =>
    createLifecycleMarket({
      question: `Will the entry-fee refund market graduate? (run ${Date.now()})`,
      // The window only needs to outlive review approval (135s budget below)
      // plus two sequential receipts and their indexed-row waits; the
      // deadline itself is reached by a chain-time jump.
      graduationSeconds: 240,
      resolutionSeconds: 250,
    }),
  );

  await step("review runner approves via heuristic provider", () =>
    waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
  );

  const receipts = await step(
    "one trader places two fee-charged receipts",
    async () => {
      // Sequential on one account (its nonces), with the manager's collateral
      // balance read around each placement: the delta observes the total
      // debit — escrowed cost plus entry fee in one transfer — which is the
      // amount `maxCost` bounds. Different sizes so the two fee amounts and
      // their floor divisions cannot coincide by accident.
      const placed = [];
      for (const order of [
        { shares: parseUnits("50", 18), side: SIDE_YES },
        { shares: parseUnits("30", 18), side: SIDE_NO },
      ]) {
        const managerBefore = await collateralBalanceOf(pregradManagerAddress);
        const receipt = await placeReceipt({
          marketId: market.marketId,
          sharesWad: order.shares,
          side: order.side,
          traderAccountIndex: SCENARIO_ACCOUNTS.entryFeeRefundTrader,
        });
        const managerAfter = await collateralBalanceOf(pregradManagerAddress);

        const fee = expectedEntryFee(receipt.cost);
        assertTruthy("fee charged on the placement", fee > 0n);
        assertEqual(
          `receipt ${receipt.receiptId}: manager received cost plus fee`,
          managerAfter - managerBefore,
          receipt.cost + fee,
        );
        placed.push({ ...receipt, fee });
      }
      return placed;
    },
  );

  await step("collected fee rows reach the paper trail", async () => {
    const rows = await waitForIndexedRows(
      "both EntryFeeCollected rows indexed",
      schema.receiptEntryFeeEvents,
      market.marketId,
      receipts.length,
    );
    assertEqual(
      "fee rows so far are exactly the collected ones",
      rows.length,
      receipts.length,
    );
    for (const receipt of receipts) {
      assertSingleFeeRow("collected row", rows, {
        account: receipt.owner.toLowerCase(),
        amount: receipt.fee,
        kind: "collected",
        receiptId: receipt.receiptId,
      });
    }
    assertEqual(
      "on-chain fee escrow holds both fees",
      await readFeeEscrow(market.marketId),
      receipts.reduce((total, receipt) => total + receipt.fee, 0n),
    );
  });

  await step("keeper opens refunds after the deadline passes", async () => {
    await jumpChainTimeTo(market.graduationDeadline + 1n);

    // The keeper's periodic sweep finds the past-deadline market ineligible
    // and settles the no-match outcome via markRefundable, exactly as in
    // failed-graduation.
    await waitForApiStatus(market.marketId, "refunded", { timeoutMs: 120_000 });
    await assertChainStatus(
      "on-chain status after refund opens",
      market.marketId,
      MARKET_STATUS.refunded,
    );
  });

  await step("refund claims return escrow plus the full fee", async () => {
    for (const receipt of receipts) {
      const claim = await claimRefundedReceipt({
        receiptId: receipt.receiptId,
        traderAccountIndex: SCENARIO_ACCOUNTS.entryFeeRefundTrader,
      });
      assertEqual(
        `receipt ${receipt.receiptId}: refunded cost plus fee`,
        claim.refunded,
        receipt.cost + receipt.fee,
      );
    }
  });

  await step("refunded fee rows mirror the collected rows", async () => {
    const rows = await waitForIndexedRows(
      "collected and refunded fee rows indexed",
      schema.receiptEntryFeeEvents,
      market.marketId,
      receipts.length * 2,
    );
    assertEqual(
      "exactly one collected and one refunded row per receipt",
      rows.length,
      receipts.length * 2,
    );
    for (const receipt of receipts) {
      assertSingleFeeRow("refunded row", rows, {
        account: receipt.owner.toLowerCase(),
        amount: receipt.fee,
        kind: "refunded",
        receiptId: receipt.receiptId,
      });
    }
    assertEqual(
      "fee escrow drained by the claims",
      await readFeeEscrow(market.marketId),
      0n,
    );
    assertEqual(
      "nothing earned on the non-graduation path",
      await readFeesEarned(market.marketId),
      0n,
    );
  });

  await step("money paper trail balances end to end", () =>
    assertMarketPaperTrail({
      createdBlock: market.createdBlock,
      marketId: market.marketId,
    }),
  );
}

/**
 * Place → graduate → claim. The graduated claims split each receipt's fee
 * pro rata by matched cost; the split book guarantees both split directions
 * actually occur.
 */
async function runGraduationPath(
  step: ScenarioContext["step"],
  disarmedRateWad: bigint,
): Promise<void> {
  const market = await step("create the graduation-path market", () =>
    createLifecycleMarket({
      question: `Will the entry-fee graduation market split its fees? (run ${Date.now()})`,
      // Generous window, mirroring partial-clearing: balanced buys, the
      // excess receipt, the disarm transaction, and the keeper's graduation
      // pass must all land before the deadline; no resolution.
      graduationSeconds: 600,
      resolutionSeconds: 700,
    }),
  );

  await step("review runner approves via heuristic provider", () =>
    waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
  );

  try {
    // Pause inside the try so the finally always restarts the keeper, even
    // if the stop request itself rejects mid-flight (partial-clearing's
    // pattern: the live ReceiptPlaced watcher would otherwise graduate the
    // balanced book before the excess lands).
    await step("pause the keeper to assemble the book atomically", () =>
      stopService("keeper"),
    );

    const balanced = await step(
      "place balanced liquidity to threshold (the retained band)",
      () =>
        placeGraduationLiquidity({
          marketId: market.marketId,
          thresholdWad: market.graduationThresholdWad,
          yesTraderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationYes,
          noTraderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationNo,
        }),
    );

    const excess = await step(
      "place one-sided YES excess (the fee-splitting receipt)",
      () =>
        placeReceipt({
          marketId: market.marketId,
          sharesWad: market.graduationThresholdWad / 4n,
          side: SIDE_YES,
          traderAccountIndex: SCENARIO_ACCOUNTS.entryFeeGraduationYes,
        }),
    );

    const receiptCount = balanced.receiptCount + 1;

    const placedRows = await step(
      "every placement carries a collected fee row",
      async () => {
        const placed = await waitForIndexedRows(
          `all ${receiptCount} receipts indexed`,
          schema.receiptPlacedEvents,
          market.marketId,
          receiptCount,
        );
        const feeRows = await waitForIndexedRows(
          `all ${receiptCount} collected fee rows indexed`,
          schema.receiptEntryFeeEvents,
          market.marketId,
          receiptCount,
        );
        assertEqual(
          "one collected row per placement",
          feeRows.length,
          receiptCount,
        );
        for (const row of placed) {
          assertSingleFeeRow("collected row", feeRows, {
            account: row.owner.toLowerCase(),
            amount: expectedEntryFee(row.cost),
            kind: "collected",
            receiptId: row.receiptId,
          });
        }
        assertEqual(
          "on-chain fee escrow holds every fee",
          await readFeeEscrow(market.marketId),
          placed.reduce((total, row) => total + expectedEntryFee(row.cost), 0n),
        );
        return placed;
      },
    );

    await step("disarm the fee before the graduated claims", async () => {
      // The claims below must pay each receipt's STORED fee even though the
      // live rate is back at the stack default — ADR 0014: store the paid
      // fee on the receipt, never derive it at settlement time. With the
      // rate at zero, a derive-at-settlement bug would zero every split row
      // and fail the exact-amount assertions.
      await setEntryFeeRateAsOwner(disarmedRateWad);
      assertEqual(
        "live rate handed back before settlement",
        await publicClient.readContract({
          abi: pregradManagerAbi,
          address: pregradManagerAddress,
          functionName: "entryFeeRateWad",
        }),
        disarmedRateWad,
      );
    });

    await step("resume the keeper", () => startService("keeper"));

    const graduated = await step(
      "keeper graduates the market on a partial clearing",
      () =>
        waitForApiStatus(market.marketId, "graduated", {
          requirePostgrad: true,
          timeoutMs: 240_000,
        }),
    );

    await step("graduated claims split each fee by matched cost", async () => {
      const claims = await waitForIndexedRows(
        `all ${receiptCount} graduated-receipt claims indexed`,
        schema.graduatedReceiptClaimedEvents,
        market.marketId,
        receiptCount,
      );

      // Expected fee movements re-derived per receipt from its own facts —
      // cost from ReceiptPlaced, refund from the claim — with the contract's
      // own rounding (full-precision mulDiv, floor).
      const expected = claims.map((claim) => {
        const placed = assertTruthy(
          `ReceiptPlaced row for receipt ${claim.receiptId}`,
          placedRows.find((row) => row.receiptId === claim.receiptId),
        );
        const fee = expectedEntryFee(placed.cost);
        const refundedFee = (fee * claim.refund) / placed.cost;
        return {
          earnedFee: fee - refundedFee,
          owner: placed.owner.toLowerCase(),
          receiptId: claim.receiptId,
          refundedFee,
        };
      });

      // The split is genuinely two-sided: a fully-matched receipt keeps its
      // whole fee, and the crowded side's proration sends fee home — led by
      // the one-sided excess, which is why the book was assembled split.
      assertTruthy(
        "at least one receipt's fee is fully earned",
        expected.some(
          (entry) => entry.refundedFee === 0n && entry.earnedFee > 0n,
        ),
      );
      const excessExpected = assertTruthy(
        "expected fee split for the excess receipt",
        expected.find((entry) => entry.receiptId === excess.receiptId),
      );
      assertTruthy(
        "the excess receipt's fee partly refunds",
        excessExpected.refundedFee > 0n,
      );

      const expectedRowCount =
        receiptCount +
        expected.filter((entry) => entry.earnedFee > 0n).length +
        expected.filter((entry) => entry.refundedFee > 0n).length;
      const feeRows = await waitForIndexedRows(
        `all ${expectedRowCount} fee rows indexed after the claims`,
        schema.receiptEntryFeeEvents,
        market.marketId,
        expectedRowCount,
      );
      assertEqual(
        "no fee rows beyond collected plus the expected splits",
        feeRows.length,
        expectedRowCount,
      );

      for (const entry of expected) {
        if (entry.earnedFee > 0n) {
          assertSingleFeeRow("earned row", feeRows, {
            account: null,
            amount: entry.earnedFee,
            kind: "earned",
            receiptId: entry.receiptId,
          });
        } else {
          assertEqual(
            `receipt ${entry.receiptId}: no earned row`,
            feeRowsOf(feeRows, entry.receiptId, "earned").length,
            0,
          );
        }
        if (entry.refundedFee > 0n) {
          assertSingleFeeRow("refunded row", feeRows, {
            account: entry.owner,
            amount: entry.refundedFee,
            kind: "refunded",
            receiptId: entry.receiptId,
          });
        } else {
          assertEqual(
            `receipt ${entry.receiptId}: no refunded row`,
            feeRowsOf(feeRows, entry.receiptId, "refunded").length,
            0,
          );
        }
      }

      // Conservation across the market: every collected unit is either
      // earned or refunded, and the on-chain pots agree with the ledger.
      const totalByKind = (kind: FeeRow["kind"]) =>
        feeRows
          .filter((row) => row.kind === kind)
          .reduce((total, row) => total + row.amount, 0n);
      assertEqual(
        "collected equals earned plus refunded",
        totalByKind("collected"),
        totalByKind("earned") + totalByKind("refunded"),
      );
      assertEqual(
        "fee escrow drained by the claims",
        await readFeeEscrow(market.marketId),
        0n,
      );
      assertEqual(
        "earned pot matches the ledger",
        await readFeesEarned(market.marketId),
        totalByKind("earned"),
      );
    });

    await step("money paper trail balances end to end", () =>
      assertMarketPaperTrailEventually({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
        postgradMarketAddress: graduated.postgrad?.marketAddress as Address,
      }),
    );
  } finally {
    // Safety net: the keeper must be running for later scenarios even if a
    // step above threw while it was paused. startService is idempotent, so
    // this is a no-op on the success path. Swallow its own failure so the
    // original step error still propagates as the diagnostic.
    await startService("keeper").catch((error: unknown) => {
      console.error(
        `[entry-fee] failed to restart the keeper during cleanup: ${
          error instanceof Error ? error.message : error
        }`,
      );
    });
  }
}

type FeeRow = typeof schema.receiptEntryFeeEvents.$inferSelect;

/**
 * The contract's fee arithmetic re-derived: `entryFeeFor` is
 * Math.mulDiv(cost, rate, WAD) — full-precision floor division, which plain
 * bigint arithmetic reproduces exactly.
 */
function expectedEntryFee(cost: bigint): bigint {
  return (cost * ENTRY_FEE_RATE_WAD) / WAD;
}

function feeRowsOf(
  rows: readonly FeeRow[],
  receiptId: bigint,
  kind: FeeRow["kind"],
): FeeRow[] {
  return rows.filter((row) => row.receiptId === receiptId && row.kind === kind);
}

/** Exactly one row of `kind` for the receipt, with exact amount and account. */
function assertSingleFeeRow(
  label: string,
  rows: readonly FeeRow[],
  expected: {
    account: string | null;
    amount: bigint;
    kind: FeeRow["kind"];
    receiptId: bigint;
  },
): void {
  const matching = feeRowsOf(rows, expected.receiptId, expected.kind);
  assertEqual(
    `${label} for receipt ${expected.receiptId}: row count`,
    matching.length,
    1,
  );
  const row = assertTruthy(
    `${label} for receipt ${expected.receiptId}`,
    matching[0],
  );
  assertEqual(
    `${label} for receipt ${expected.receiptId}: amount`,
    row.amount,
    expected.amount,
  );
  assertEqual(
    `${label} for receipt ${expected.receiptId}: account`,
    row.account,
    expected.account,
  );
}

async function collateralBalanceOf(holder: Address): Promise<bigint> {
  return publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [holder],
  });
}

/** The fee still held refundable for the market (the second escrow). */
async function readFeeEscrow(marketId: bigint): Promise<bigint> {
  return publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketEntryFeeEscrow",
    args: [marketId],
  });
}

/** The fee the market's graduated claims have earned for the protocol. */
async function readFeesEarned(marketId: bigint): Promise<bigint> {
  return publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketEntryFeesEarned",
    args: [marketId],
  });
}
