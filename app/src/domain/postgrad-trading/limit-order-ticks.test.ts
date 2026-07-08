import {
  alignTickToSpacing as protocolAlignTickToSpacing,
  displayPriceWadToTick as protocolDisplayPriceWadToTick,
  tickToDisplayPriceWad,
} from "@popcharts/protocol";
import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import {
  alignTickToSpacing,
  buildLimitOrderTickRange,
  displayPriceWadToTick,
  isRestingTickRange,
} from "./limit-order-ticks";

// The protocol package's root export resolves under vitest (only Next's
// bundler rejects its `.js` specifiers), so these tests lock the app-side
// mapping to the protocol implementation the venue was configured with.
const ORIENTATIONS = [true, false] as const;
const ROUNDINGS = ["down", "up"] as const;
const ADR_0009_DECIMALS = { collateralDecimals: 18, outcomeDecimals: 18 };

describe("displayPriceWadToTick", () => {
  it("matches the protocol implementation for every whole-cent price", () => {
    for (const outcomeIsCurrency0 of ORIENTATIONS) {
      for (const rounding of ROUNDINGS) {
        for (let cents = 1; cents <= 99; cents += 1) {
          const displayPriceWad = (BigInt(cents) * WAD) / 100n;

          expect(
            displayPriceWadToTick({ displayPriceWad, outcomeIsCurrency0, rounding }),
            `cents=${cents} outcomeIsCurrency0=${outcomeIsCurrency0} rounding=${rounding}`
          ).toBe(
            protocolDisplayPriceWadToTick({
              ...ADR_0009_DECIMALS,
              displayPriceWad,
              outcomeIsCurrency0,
              rounding,
            })
          );
        }
      }
    }
  });

  it("matches the protocol implementation on irregular WAD prices", () => {
    const prices = [
      1n, // one wei of display price
      1_000_000_000_000_000n, // epsilon band floor (0.1c)
      123_456_789_012_345_678n,
      500_000_000_000_000_000n,
      999_000_000_000_000_000n, // epsilon band ceiling (99.9c)
      5n * WAD, // above one whole collateral per token
    ];

    for (const outcomeIsCurrency0 of ORIENTATIONS) {
      for (const rounding of ROUNDINGS) {
        for (const displayPriceWad of prices) {
          expect(
            displayPriceWadToTick({ displayPriceWad, outcomeIsCurrency0, rounding }),
            `price=${displayPriceWad} outcomeIsCurrency0=${outcomeIsCurrency0} rounding=${rounding}`
          ).toBe(
            protocolDisplayPriceWadToTick({
              ...ADR_0009_DECIMALS,
              displayPriceWad,
              outcomeIsCurrency0,
              rounding,
            })
          );
        }
      }
    }
  });

  it("rounds an exact tick price to the same tick in both directions", () => {
    // Tick 0 prices at exactly 1.0 collateral per token in both orientations.
    for (const outcomeIsCurrency0 of ORIENTATIONS) {
      expect(
        displayPriceWadToTick({
          displayPriceWad: WAD,
          outcomeIsCurrency0,
          rounding: "down",
        })
      ).toBe(0);
      expect(
        displayPriceWadToTick({
          displayPriceWad: WAD,
          outcomeIsCurrency0,
          rounding: "up",
        })
      ).toBe(0);
    }
  });

  it("rejects non-positive prices", () => {
    expect(() =>
      displayPriceWadToTick({
        displayPriceWad: 0n,
        outcomeIsCurrency0: true,
        rounding: "down",
      })
    ).toThrow(/must be positive/);
  });
});

describe("alignTickToSpacing", () => {
  it("matches the protocol implementation across signs and offsets", () => {
    const ticks = [-887272, -121, -60, -59, -1, 0, 1, 59, 60, 61, 887272];

    for (const tick of ticks) {
      for (const rounding of ROUNDINGS) {
        expect(alignTickToSpacing(tick, 60, rounding), `tick=${tick} ${rounding}`).toBe(
          protocolAlignTickToSpacing(tick, 60, rounding)
        );
      }
    }
  });

  it("normalizes negative zero", () => {
    expect(Object.is(alignTickToSpacing(-1, 60, "up"), 0)).toBe(true);
  });
});

describe("buildLimitOrderTickRange", () => {
  it.each([
    { direction: "ask", outcomeIsCurrency0: true, zeroForOne: true },
    { direction: "ask", outcomeIsCurrency0: false, zeroForOne: false },
    { direction: "bid", outcomeIsCurrency0: true, zeroForOne: false },
    { direction: "bid", outcomeIsCurrency0: false, zeroForOne: true },
  ] as const)(
    "supplies the maker currency for a $direction (outcomeIsCurrency0=$outcomeIsCurrency0)",
    ({ direction, outcomeIsCurrency0, zeroForOne }) => {
      const range = buildLimitOrderTickRange({
        direction,
        outcomeIsCurrency0,
        priceWad: (30n * WAD) / 100n,
      });

      expect(range.zeroForOne).toBe(zeroForOne);
      expect(range.tickUpper - range.tickLower).toBe(60);
      expect(range.nearEdgeTick).toBe(zeroForOne ? range.tickLower : range.tickUpper);
      expect(range.tickLower % 60 === 0).toBe(true);
      expect(range.tickUpper % 60 === 0).toBe(true);
    }
  );

  it("keeps the near edge on the conservative side of the entered price", () => {
    for (const outcomeIsCurrency0 of ORIENTATIONS) {
      for (let cents = 1; cents <= 99; cents += 1) {
        const priceWad = (BigInt(cents) * WAD) / 100n;
        const bid = buildLimitOrderTickRange({
          direction: "bid",
          outcomeIsCurrency0,
          priceWad,
        });
        const ask = buildLimitOrderTickRange({
          direction: "ask",
          outcomeIsCurrency0,
          priceWad,
        });
        const displayAt = (tick: number) =>
          tickToDisplayPriceWad({ ...ADR_0009_DECIMALS, outcomeIsCurrency0, tick });

        // A bid never rests above the entered price, an ask never below it.
        expect(
          displayAt(bid.nearEdgeTick) <= priceWad,
          `bid cents=${cents} outcomeIsCurrency0=${outcomeIsCurrency0}`
        ).toBe(true);
        expect(
          displayAt(ask.nearEdgeTick) >= priceWad,
          `ask cents=${cents} outcomeIsCurrency0=${outcomeIsCurrency0}`
        ).toBe(true);
        // Within one spacing of the target, not drifting further away.
        expect(Math.abs(bid.nearEdgeTick - ask.nearEdgeTick) <= 60).toBe(true);
      }
    }
  });
});

describe("isRestingTickRange", () => {
  it.each([
    { currentTick: -61, expected: true, zeroForOne: true },
    { currentTick: -60, expected: false, zeroForOne: true },
    { currentTick: 0, expected: false, zeroForOne: true },
    { currentTick: 1, expected: true, zeroForOne: false },
    { currentTick: 0, expected: false, zeroForOne: false },
    { currentTick: -61, expected: false, zeroForOne: false },
  ])(
    "zeroForOne=$zeroForOne currentTick=$currentTick -> $expected",
    ({ currentTick, expected, zeroForOne }) => {
      expect(
        isRestingTickRange({ currentTick, tickLower: -60, tickUpper: 0, zeroForOne })
      ).toBe(expected);
    }
  );
});
