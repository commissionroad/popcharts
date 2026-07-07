import { describe, expect, it } from "bun:test";

import type { DevMarketGraduateResult } from "src/api/services/dev-market-graduate";

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

describe("runGraduationPass", () => {
  it("settles an eligible market without force", async () => {
    const { calls, graduate } = graduateReturning({
      kind: "graduated",
      market: {} as never,
      postgrad: {} as never,
      summary: {} as never,
      transactionHashes: [],
    });

    const outcome = await runGraduationPass({ graduate, market });

    expect(outcome).toBe("graduated");
    expect(calls).toEqual([{ chainId: 31337, force: false, marketId: "7" }]);
  });

  it("treats a below-threshold market as a quiet no-op", async () => {
    const { graduate } = graduateReturning({
      kind: "ineligible",
      market: {} as never,
      message: "Matched liquidity is below the graduation threshold.",
      reason: "below_threshold",
    });

    await expect(runGraduationPass({ graduate, market })).resolves.toBe(
      "skipped",
    );
  });

  it("skips markets the flow reports as unavailable", async () => {
    const { graduate } = graduateReturning({
      kind: "dev_disabled",
      message: "Dev market graduation is disabled.",
    });

    await expect(runGraduationPass({ graduate, market })).resolves.toBe(
      "skipped",
    );
  });
});
