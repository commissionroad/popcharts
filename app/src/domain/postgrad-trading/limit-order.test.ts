import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import {
  getLimitPriceError,
  getLimitRestingError,
  getLimitSizeError,
  isVenueOrderCrossed,
  limitOrderDepositWad,
  limitOrderDirection,
  limitPriceCentsToWad,
  parseLimitPriceCents,
  wadPriceToCents,
} from "./limit-order";

describe("limitOrderDirection", () => {
  it("maps buys to bids and sells to asks", () => {
    expect(limitOrderDirection("buy")).toBe("bid");
    expect(limitOrderDirection("sell")).toBe("ask");
  });
});

describe("limit price parsing", () => {
  it("converts whole cents to WAD and back", () => {
    expect(limitPriceCentsToWad(30)).toBe((30n * WAD) / 100n);
    expect(limitPriceCentsToWad(99)).toBe((99n * WAD) / 100n);
    expect(wadPriceToCents((30n * WAD) / 100n)).toBeCloseTo(30);
  });

  it.each([
    { expected: 1, input: "1" },
    { expected: 45, input: " 45" },
    { expected: 99, input: "99" },
    { expected: null, input: "0" },
    { expected: null, input: "100" },
    { expected: null, input: "45.5" },
    { expected: null, input: "-3" },
    { expected: null, input: "abc" },
    { expected: null, input: "" },
  ])("parses $input to $expected", ({ expected, input }) => {
    expect(parseLimitPriceCents(input)).toBe(expected);
  });

  it("asks for a price when the input is empty", () => {
    expect(getLimitPriceError("")).toBe("Enter a limit price in cents.");
    expect(getLimitPriceError("  ")).toBe("Enter a limit price in cents.");
  });

  it("rejects out-of-band or fractional prices", () => {
    for (const input of ["0", "100", "45.5"]) {
      expect(getLimitPriceError(input)).toBe(
        "Limit price must be a whole number of cents from 1 to 99."
      );
    }
  });

  it("accepts whole cents from 1 to 99", () => {
    expect(getLimitPriceError("1")).toBeNull();
    expect(getLimitPriceError("99")).toBeNull();
  });
});

describe("getLimitSizeError", () => {
  it.each([
    { expected: "Enter a token amount.", input: "" },
    { expected: "Enter a token amount.", input: "abc" },
    { expected: "Size must be greater than zero.", input: "0" },
    { expected: "Size must be greater than zero.", input: "-5" },
    { expected: "Size is above the per-trade limit.", input: "1000001" },
    { expected: null, input: "100" },
    { expected: null, input: "0.5" },
  ])("validates $input", ({ expected, input }) => {
    expect(getLimitSizeError(input)).toBe(expected);
  });
});

describe("getLimitRestingError", () => {
  const poolPriceWad = (50n * WAD) / 100n;

  it("blocks a bid at or above the pool price", () => {
    expect(
      getLimitRestingError({ direction: "bid", poolPriceWad, priceWad: poolPriceWad })
    ).toMatch(/buy limit at or above the current price/);
    expect(
      getLimitRestingError({
        direction: "bid",
        poolPriceWad,
        priceWad: (60n * WAD) / 100n,
      })
    ).toMatch(/use a market order/);
  });

  it("blocks an ask at or below the pool price", () => {
    expect(
      getLimitRestingError({ direction: "ask", poolPriceWad, priceWad: poolPriceWad })
    ).toMatch(/sell limit at or below the current price/);
    expect(
      getLimitRestingError({
        direction: "ask",
        poolPriceWad,
        priceWad: (40n * WAD) / 100n,
      })
    ).toMatch(/use a market order/);
  });

  it("allows resting prices on the correct side", () => {
    expect(
      getLimitRestingError({
        direction: "bid",
        poolPriceWad,
        priceWad: (40n * WAD) / 100n,
      })
    ).toBeNull();
    expect(
      getLimitRestingError({
        direction: "ask",
        poolPriceWad,
        priceWad: (60n * WAD) / 100n,
      })
    ).toBeNull();
  });
});

describe("limitOrderDepositWad", () => {
  it("escrows the outcome tokens for an ask", () => {
    expect(
      limitOrderDepositWad({
        direction: "ask",
        priceWad: (30n * WAD) / 100n,
        sizeWad: 100n * WAD,
      })
    ).toBe(100n * WAD);
  });

  it("escrows size times price for a bid", () => {
    expect(
      limitOrderDepositWad({
        direction: "bid",
        priceWad: (30n * WAD) / 100n,
        sizeWad: 100n * WAD,
      })
    ).toBe(30n * WAD);
  });

  it("rounds a fractional bid deposit up so it never hits zero", () => {
    expect(
      limitOrderDepositWad({
        direction: "bid",
        priceWad: (30n * WAD) / 100n,
        sizeWad: 1n,
      })
    ).toBe(1n);
  });
});

describe("isVenueOrderCrossed", () => {
  const priceWad = (30n * WAD) / 100n;

  it("marks a bid crossed when the pool trades down to its price", () => {
    expect(
      isVenueOrderCrossed({ direction: "bid", poolPriceWad: priceWad, priceWad })
    ).toBe(true);
    expect(
      isVenueOrderCrossed({
        direction: "bid",
        poolPriceWad: (29n * WAD) / 100n,
        priceWad,
      })
    ).toBe(true);
    expect(
      isVenueOrderCrossed({
        direction: "bid",
        poolPriceWad: (31n * WAD) / 100n,
        priceWad,
      })
    ).toBe(false);
  });

  it("marks an ask crossed when the pool trades up to its price", () => {
    expect(
      isVenueOrderCrossed({ direction: "ask", poolPriceWad: priceWad, priceWad })
    ).toBe(true);
    expect(
      isVenueOrderCrossed({
        direction: "ask",
        poolPriceWad: (31n * WAD) / 100n,
        priceWad,
      })
    ).toBe(true);
    expect(
      isVenueOrderCrossed({
        direction: "ask",
        poolPriceWad: (29n * WAD) / 100n,
        priceWad,
      })
    ).toBe(false);
  });
});
