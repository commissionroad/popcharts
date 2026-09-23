import { MARKET_STATUS, SIDE_NO, SIDE_YES } from "@popcharts/protocol";
import { parseUnits } from "viem";

import { schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { waitForChainTime } from "../chain-time";
import { createLifecycleMarket } from "../market-factory";
import {
  assertChainStatus,
  waitForApiStatus,
  waitForIndexedRows,
} from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import { claimRefundedReceipt, placeReceipt } from "../pregrad-trading";
import { SCENARIO_ACCOUNTS, pregradManagerAddress } from "../stack";
import {
  assertSingleFeeRow,
  collateralBalanceOf,
  expectedEntryFee,
  readFeeEscrow,
  readFeesEarned,
} from "./entry-fee-checks";
import type { ScenarioContext } from "../report";

/**
 * Entry-fee refund path: place → deadline → refund. Runs with the fee armed
 * at 1%. Every fee comes home: refunds are 101% of cost, the fee escrow
 * drains to zero, and the earned pot never moves.
 */
export async function runRefundPath(
  step: ScenarioContext["step"],
): Promise<void> {
  const market = await step("create the refund-path market", () =>
    createLifecycleMarket({
      question: `Will the entry-fee refund market graduate? (run ${Date.now()})`,
      // Waited out in real time (ADR 0028 G4), so the window is the smallest
      // one that still outlives review approval (135s budget below) plus two
      // sequential receipts and their indexed-row waits.
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
    // Real time, not a warp — see failed-graduation, which shares this shape.
    await waitForChainTime(market.graduationDeadline + 1n);

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
