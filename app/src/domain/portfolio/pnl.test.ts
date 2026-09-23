import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import { pnlDirection, portfolioPnl, positionPnl, type PositionPnlInput } from "./pnl";

describe("pnlDirection", () => {
  it.each([
    { amount: 1n, expected: "up" },
    { amount: -1n, expected: "down" },
    { amount: 0n, expected: "flat" },
  ])("classifies $amount as $expected", ({ amount, expected }) => {
    expect(pnlDirection(amount)).toBe(expected);
  });
});

describe("positionPnl", () => {
  it("prices an open lot above its cost basis as an unrealised gain", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(4000n),
        markPriceWad: cents(62n),
        ownedTotalWad: tokens(100n),
      })
    );

    expect(pnl.marketValueWad).toBe(cents(6200n));
    expect(pnl.unrealisedWad).toBe(cents(2200n));
    expect(pnl.realisedWad).toBe(0n);
    expect(pnl.totalWad).toBe(cents(2200n));
    expect(pnl.unrealisedReturnBps).toBe(5500);
    expect(pnl.returnBps).toBe(5500);
  });

  it("prices an open lot below its cost basis as an unrealised loss", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(5500n),
        markPriceWad: cents(31n),
        ownedTotalWad: tokens(100n),
      })
    );

    expect(pnl.unrealisedWad).toBe(cents(-2400n));
    expect(pnl.unrealisedReturnBps).toBe(-4363);
  });

  it("reports break-even as exactly zero rather than a rounded gain", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(4000n),
        markPriceWad: cents(50n),
        ownedTotalWad: tokens(80n),
      })
    );

    expect(pnl.unrealisedWad).toBe(0n);
    expect(pnl.unrealisedReturnBps).toBe(0);
    expect(pnl.totalWad).toBe(0n);
  });

  it("averages entry over lots bought at different prices", () => {
    // 60 at 38c, 40 at 52c and 25 at 61c: $58.85 across 125 tokens.
    const pnl = positionPnl(
      input({
        costBasisWad: cents(5885n),
        markPriceWad: cents(55n),
        ownedTotalWad: tokens(125n),
      })
    );

    expect(pnl.avgEntryPriceWad).toBe((cents(5885n) * WAD) / tokens(125n));
    expect(pnl.marketValueWad).toBe(cents(6875n));
    expect(pnl.unrealisedWad).toBe(cents(990n));
  });

  it("keeps realised proceeds separate from the unrealised mark", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(5280n),
        markPriceWad: cents(51n),
        ownedTotalWad: tokens(120n),
        realisedCostWad: cents(3520n),
        realisedProceedsWad: cents(4640n),
      })
    );

    expect(pnl.realisedWad).toBe(cents(1120n));
    expect(pnl.unrealisedWad).toBe(cents(840n));
    expect(pnl.totalWad).toBe(cents(1960n));
    // Return is on all capital deployed: $52.80 open plus $35.20 closed.
    expect(pnl.returnBps).toBe(2227);
  });

  it("treats a fully redeemed winner as entirely realised", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: 0n,
        markPriceWad: WAD,
        ownedTotalWad: 0n,
        realisedCostWad: cents(7200n),
        realisedProceedsWad: cents(15000n),
      })
    );

    expect(pnl.avgEntryPriceWad).toBeNull();
    expect(pnl.marketValueWad).toBe(0n);
    expect(pnl.unrealisedWad).toBe(0n);
    expect(pnl.realisedWad).toBe(cents(7800n));
    expect(pnl.returnBps).toBe(10833);
  });

  it("marks a resolved loser at zero, wiping out the whole basis", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(5400n),
        markPriceWad: 0n,
        ownedTotalWad: tokens(120n),
      })
    );

    expect(pnl.marketValueWad).toBe(0n);
    expect(pnl.unrealisedWad).toBe(cents(-5400n));
    expect(pnl.unrealisedReturnBps).toBe(-10000);
  });

  it("leaves an unpriced open lot without a value or a gain", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: cents(3600n),
        markPriceWad: null,
        ownedTotalWad: tokens(90n),
      })
    );

    expect(pnl.marketValueWad).toBeNull();
    expect(pnl.unrealisedWad).toBeNull();
    expect(pnl.totalWad).toBeNull();
    expect(pnl.returnBps).toBeNull();
    expect(pnl.unrealisedReturnBps).toBeNull();
  });

  it("closes out an unpriced position that owns nothing", () => {
    const pnl = positionPnl(
      input({
        costBasisWad: 0n,
        markPriceWad: null,
        ownedTotalWad: 0n,
        realisedCostWad: cents(1000n),
        realisedProceedsWad: cents(1500n),
      })
    );

    expect(pnl.marketValueWad).toBe(0n);
    expect(pnl.totalWad).toBe(cents(500n));
  });

  it("returns no percentage when no capital was deployed", () => {
    const pnl = positionPnl(input({ costBasisWad: 0n, markPriceWad: 0n }));

    expect(pnl.returnBps).toBeNull();
    expect(pnl.unrealisedReturnBps).toBeNull();
  });
});

describe("portfolioPnl", () => {
  it("sums an empty portfolio to zero with no return", () => {
    expect(portfolioPnl([])).toEqual({
      costBasisWad: 0n,
      marketValueWad: 0n,
      realisedWad: 0n,
      returnBps: null,
      totalWad: 0n,
      unpricedCount: 0,
      unrealisedWad: 0n,
    });
  });

  it("rolls gains and losses up across positions", () => {
    const summary = portfolioPnl([
      input({
        costBasisWad: cents(4000n),
        markPriceWad: cents(62n),
        ownedTotalWad: tokens(100n),
      }),
      input({
        costBasisWad: cents(5500n),
        markPriceWad: cents(31n),
        ownedTotalWad: tokens(100n),
      }),
      input({
        costBasisWad: 0n,
        markPriceWad: WAD,
        ownedTotalWad: 0n,
        realisedCostWad: cents(7200n),
        realisedProceedsWad: cents(15000n),
      }),
    ]);

    expect(summary.costBasisWad).toBe(cents(9500n));
    expect(summary.marketValueWad).toBe(cents(9300n));
    expect(summary.unrealisedWad).toBe(cents(-200n));
    expect(summary.realisedWad).toBe(cents(7800n));
    expect(summary.totalWad).toBe(cents(7600n));
    expect(summary.unpricedCount).toBe(0);
    // $76.00 on $167.00 of capital deployed.
    expect(summary.returnBps).toBe(4550);
  });

  it("counts an unpriced position without letting it contribute a gain", () => {
    const summary = portfolioPnl([
      input({
        costBasisWad: cents(4000n),
        markPriceWad: cents(62n),
        ownedTotalWad: tokens(100n),
      }),
      input({
        costBasisWad: cents(3600n),
        markPriceWad: null,
        ownedTotalWad: tokens(90n),
      }),
    ]);

    expect(summary.unpricedCount).toBe(1);
    expect(summary.marketValueWad).toBe(cents(6200n));
    expect(summary.unrealisedWad).toBe(cents(2200n));
    // The unpriced lot's $36.00 still sits in the denominator.
    expect(summary.costBasisWad).toBe(cents(7600n));
    expect(summary.returnBps).toBe(2894);
  });
});

/** A WAD money amount from whole cents — no float touches a fixture. */
function cents(value: bigint) {
  return (WAD * value) / 100n;
}

/** A WAD outcome-token amount from whole tokens. */
function tokens(value: bigint) {
  return WAD * value;
}

function input(overrides: Partial<PositionPnlInput> = {}): PositionPnlInput {
  return {
    costBasisWad: cents(1000n),
    markPriceWad: cents(50n),
    ownedTotalWad: tokens(20n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    ...overrides,
  };
}
