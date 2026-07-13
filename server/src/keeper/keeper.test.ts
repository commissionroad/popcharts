import { describe, expect, it } from "bun:test";

import type { DevMarketGraduateResult } from "src/api/services/dev-market-graduate";
import type { RefundPregradMarketResult } from "src/api/services/pregrad-refund";

import { runGraduationPass } from "./keeper";

const market = {
  chainId: 31337,
  graduationThreshold: 2_500n * 10n ** 18n,
  key: "pregrad:31337:7",
  label: "pregrad market 31337:7",
  marketId: 7n,
};

function graduateReturning(result: DevMarketGraduateResult) {
  const calls: unknown[] = [];

  return {
    calls,
    graduate: async (args: unknown) => {
      calls.push(args);
      return result;
    },
  };
}

function refundReturning(result: RefundPregradMarketResult) {
  const calls: unknown[] = [];

  return {
    calls,
    refund: async (args: unknown) => {
      calls.push(args);
      return result;
    },
  };
}

/** A refund seam that fails the test if the pass ever reaches it. */
function refundUnexpected() {
  return async () => {
    throw new Error("refund should not be called");
  };
}

describe("runGraduationPass", () => {
  it("settles an eligible market without force and never refunds it", async () => {
    const { calls, graduate } = graduateReturning({
      kind: "graduated",
      market: {} as never,
      postgrad: {} as never,
      summary: {} as never,
      transactionHashes: [],
    });

    const outcome = await runGraduationPass({
      graduate,
      market,
      refund: refundUnexpected(),
    });

    expect(outcome).toBe("graduated");
    expect(calls).toEqual([{ chainId: 31337, force: false, marketId: "7" }]);
  });

  it("treats a below-threshold market as a quiet no-op without refunding", async () => {
    const { graduate } = graduateReturning({
      kind: "ineligible",
      market: {} as never,
      message: "Matched liquidity is below the graduation threshold.",
      reason: "below_threshold",
    });

    await expect(
      runGraduationPass({ graduate, market, refund: refundUnexpected() }),
    ).resolves.toBe("skipped");
  });

  it("opens refunds for a market past its deadline that never matched", async () => {
    const { graduate } = graduateReturning({
      kind: "ineligible",
      market: {} as never,
      message: "Market passed its graduation deadline; close it for refunds.",
      reason: "past_deadline",
    });
    const { calls, refund } = refundReturning("refunded");

    const outcome = await runGraduationPass({ graduate, market, refund });

    expect(outcome).toBe("refunded");
    expect(calls).toEqual([{ chainId: 31337, marketId: 7n }]);
  });

  it("skips when the past-deadline market is no longer refundable on-chain", async () => {
    const { graduate } = graduateReturning({
      kind: "ineligible",
      market: {} as never,
      message: "Market passed its graduation deadline; close it for refunds.",
      reason: "past_deadline",
    });
    const { refund } = refundReturning("skipped");

    await expect(runGraduationPass({ graduate, market, refund })).resolves.toBe(
      "skipped",
    );
  });

  it("skips markets the flow reports as unavailable", async () => {
    const { graduate } = graduateReturning({
      kind: "dev_disabled",
      message: "Dev market graduation is disabled.",
    });

    await expect(
      runGraduationPass({ graduate, market, refund: refundUnexpected() }),
    ).resolves.toBe("skipped");
  });
});
