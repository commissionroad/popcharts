import type { PortfolioReceipt } from "@popcharts/api-client/models";
import { describe, expect, it } from "vitest";

import type { Market } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";

import {
  closedMarketRefunds,
  marketClosure,
  marketClosureKind,
  receiptClosure,
  refundBreakdown,
  refundSplitRows,
} from "./refund-breakdown";

type ClosureInput = Pick<
  Market,
  "closesAt" | "graduationTargetUsd" | "matchedUsd" | "resolution" | "status"
>;

function closureInput(overrides: Partial<ClosureInput> = {}): ClosureInput {
  return {
    closesAt: "2026-08-14T00:00:00.000Z",
    graduationTargetUsd: 12_500,
    matchedUsd: 3_140,
    status: "refunded",
    ...overrides,
  };
}

function receipt(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    marketStatus: "refunded",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: "0",
    priceBandLow: "0",
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "refund_claimable",
    ...overrides,
  };
}

const DRAW = {
  kind: "cancelled",
  postgradMarket: "0x00000000000000000000000000000000000000f1",
  resolvedAt: "2026-08-20T00:00:00.000Z",
} as const;

describe("marketClosureKind", () => {
  it("reads a refunded market as a market that never graduated", () => {
    expect(marketClosureKind({ status: "refunded" })).toBe("not_graduated");
  });

  it("reads a cancelled market with no resolution as a pre-graduation cancel", () => {
    expect(marketClosureKind({ status: "cancelled" })).toBe("cancelled");
  });

  it("refuses a cancelled market carrying a terminal resolution — a postgrad draw", () => {
    expect(marketClosureKind({ resolution: DRAW, status: "cancelled" })).toBeNull();
  });

  it.each(["bootstrap", "graduated", "resolved", "rejected"] as const)(
    "refuses a %s market",
    (status) => {
      expect(marketClosureKind({ status })).toBeNull();
    }
  );
});

describe("marketClosure", () => {
  it("returns nothing for a market that did not close without graduating", () => {
    expect(marketClosure(closureInput({ status: "graduated" }))).toBeNull();
  });

  it("names both sides of the shortfall for a market that ran out of time", () => {
    const closure = marketClosure(closureInput());

    expect(closure?.kind).toBe("not_graduated");
    expect(closure?.headline).toBe("Closed without graduating");
    expect(closure?.detail).toContain("$3,140 of its $12,500 graduation target");
    expect(closure?.detail).toContain("Aug 14, 2026");
    expect(closure?.summary).toContain("refunds in full");
  });

  it("drops the shortfall sentence when no graduation target was recorded", () => {
    const closure = marketClosure(closureInput({ graduationTargetUsd: 0 }));

    expect(closure?.detail).not.toContain("graduation target");
    expect(closure?.detail).toContain("without reaching graduation");
  });

  it("explains an owner cancel as a withdrawal rather than a shortfall", () => {
    const closure = marketClosure(closureInput({ status: "cancelled" }));

    expect(closure?.kind).toBe("cancelled");
    expect(closure?.headline).toBe("Cancelled before graduation");
    expect(closure?.detail).toContain("cancelled this market before it graduated");
    expect(closure?.detail).not.toContain("graduation target");
  });
});

describe("receiptClosure", () => {
  it("reads the closure from the market status a receipt carries", () => {
    expect(receiptClosure({ marketStatus: "refunded" })?.kind).toBe("not_graduated");
    expect(receiptClosure({ marketStatus: "cancelled" })?.kind).toBe("cancelled");
  });

  it("returns nothing for a market on any other path", () => {
    expect(receiptClosure({ marketStatus: "graduated" })).toBeNull();
  });

  it("says the same thing as the market-level closure", () => {
    expect(receiptClosure({ marketStatus: "refunded" })?.summary).toBe(
      marketClosure(closureInput())?.summary
    );
  });
});

describe("refundBreakdown", () => {
  it("returns a claimable receipt's whole escrowed cost", () => {
    const breakdown = refundBreakdown([receipt()]);

    expect(breakdown.claimable).toHaveLength(1);
    expect(breakdown.claimable[0]?.escrowWad).toBe(60n * WAD);
    expect(breakdown.claimable[0]?.totalWad).toBe(60n * WAD);
    expect(breakdown.claimableTotalWad).toBe(60n * WAD);
  });

  it("adds a known entry fee to the amount the wallet receives", () => {
    const fee = (60n * WAD) / 100n;
    const breakdown = refundBreakdown([receipt()], { "11": fee.toString() });

    expect(breakdown.claimable[0]?.entryFeeWad).toBe(fee);
    expect(breakdown.claimable[0]?.totalWad).toBe(60n * WAD + fee);
    expect(breakdown.entryFeeTotalWad).toBe(fee);
  });

  it("reports no entry-fee total when any claimable line's fee is unknown", () => {
    const breakdown = refundBreakdown(
      [receipt({ receiptId: "11" }), receipt({ receiptId: "12" })],
      { "11": ((60n * WAD) / 100n).toString() }
    );

    expect(breakdown.claimable[0]?.entryFeeWad).toBe((60n * WAD) / 100n);
    expect(breakdown.claimable[1]?.entryFeeWad).toBeNull();
    expect(breakdown.entryFeeTotalWad).toBeNull();
  });

  it("reports a claimed refund from what the settlement actually returned", () => {
    const breakdown = refundBreakdown([
      receipt({
        settlement: {
          claimedAt: "2026-08-16T00:00:00.000Z",
          refund: (61n * WAD).toString(),
        },
        status: "refunded",
      }),
    ]);

    expect(breakdown.claimable).toHaveLength(0);
    expect(breakdown.claimedTotalWad).toBe(61n * WAD);
  });

  it("falls back to escrowed cost for a claimed receipt with no settlement row yet", () => {
    const breakdown = refundBreakdown([receipt({ status: "refunded" })]);

    expect(breakdown.claimedTotalWad).toBe(60n * WAD);
  });

  it("ignores receipts that are not in a refund state", () => {
    const breakdown = refundBreakdown([
      receipt({ status: "awaiting_graduation" }),
      receipt({ receiptId: "12", status: "settled" }),
      receipt({ receiptId: "13", status: "claimable" }),
    ]);

    expect(breakdown.claimable).toHaveLength(0);
    expect(breakdown.claimed).toHaveLength(0);
    expect(breakdown.entryFeeTotalWad).toBe(0n);
  });
});

describe("refundSplitRows", () => {
  it("reports one total when the entry fee is unknown, never a zero fee row", () => {
    const rows = refundSplitRows(refundBreakdown([receipt()]));

    expect(rows).toEqual([{ label: "Refund", value: "$60.00" }]);
  });

  it("splits escrow from the returned entry fee when the paid fee is known", () => {
    const rows = refundSplitRows(
      refundBreakdown([receipt()], { "11": ((60n * WAD) / 100n).toString() })
    );

    expect(rows).toEqual([
      { label: "Escrowed cost", value: "$60.00" },
      { label: "Entry fee returned", value: "$0.60" },
      { label: "Total refund", value: "$60.60" },
    ]);
  });
});

describe("closedMarketRefunds", () => {
  it("groups a market's refund receipts into one row, in first-seen order", () => {
    const rows = closedMarketRefunds(
      [
        receipt({
          marketId: "9",
          marketQuestion: "Ferry?",
          marketStatus: "cancelled",
          receiptId: "21",
        }),
        receipt({ receiptId: "11" }),
        receipt({ receiptId: "12", status: "refunded" }),
      ],
      31337
    );

    expect(rows.map((row) => row.marketAppId)).toEqual(["31337:9", "31337:7"]);
    expect(rows[0]?.closure.kind).toBe("cancelled");
    expect(rows[0]?.question).toBe("Ferry?");
    expect(rows[1]?.breakdown.claimable).toHaveLength(1);
    expect(rows[1]?.breakdown.claimed).toHaveLength(1);
  });

  it("drops receipts whose market took another path", () => {
    expect(
      closedMarketRefunds(
        [receipt({ marketStatus: "graduated", status: "settled" })],
        31337
      )
    ).toEqual([]);
  });

  it("drops a closed market's non-refund receipts rather than seeding an empty row", () => {
    expect(
      closedMarketRefunds([receipt({ status: "awaiting_graduation" })], 31337)
    ).toEqual([]);
  });

  it("falls back to the market id when the receipt carries no question", () => {
    const bare = receipt();
    delete bare.marketQuestion;

    expect(closedMarketRefunds([bare], 31337)[0]?.question).toBe("Market #7");
  });

  it("passes entry fees through to each market's breakdown", () => {
    const rows = closedMarketRefunds([receipt()], 31337, {
      "11": ((60n * WAD) / 100n).toString(),
    });

    expect(rows[0]?.breakdown.entryFeeTotalWad).toBe((60n * WAD) / 100n);
  });
});
