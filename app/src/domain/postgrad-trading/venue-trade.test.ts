import { describe, expect, it } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import {
  buildVenueSwapQuote,
  estimateVenueSwapOutput,
  getVenueTradeAmountError,
  MAX_VENUE_TRADE_AMOUNT,
  parseVenueTradeAmount,
  poolPriceWadForSide,
  toVenueTokenUnits,
  venueTokenUnitsToNumber,
} from "./venue-trade";

const WAD = 10n ** 18n;

describe("parseVenueTradeAmount", () => {
  it("parses decimal amounts", () => {
    expect(parseVenueTradeAmount("250")).toBe(250);
    expect(parseVenueTradeAmount("0.5")).toBe(0.5);
  });

  it("returns null for unparseable input", () => {
    expect(parseVenueTradeAmount("")).toBeNull();
    expect(parseVenueTradeAmount("abc")).toBeNull();
  });
});

describe("getVenueTradeAmountError", () => {
  it("names the collateral unit for empty buy input", () => {
    expect(getVenueTradeAmountError("", "buy")).toBe("Enter a collateral amount.");
  });

  it("names the token unit for empty sell input", () => {
    expect(getVenueTradeAmountError("", "sell")).toBe("Enter a token amount.");
  });

  it("rejects zero and negative amounts", () => {
    expect(getVenueTradeAmountError("0", "buy")).toBe(
      "Amount must be greater than zero."
    );
  });

  it("rejects amounts above the per-trade limit", () => {
    expect(getVenueTradeAmountError(String(MAX_VENUE_TRADE_AMOUNT + 1), "sell")).toBe(
      "Amount is above the per-trade limit."
    );
  });

  it("accepts tradable amounts", () => {
    expect(getVenueTradeAmountError("250", "buy")).toBeNull();
  });
});

describe("token unit conversion", () => {
  it("round-trips whole and fractional amounts at 18 decimals", () => {
    expect(toVenueTokenUnits(250)).toBe(250n * WAD);
    expect(toVenueTokenUnits(0.25)).toBe(WAD / 4n);
    expect(venueTokenUnitsToNumber(250n * WAD)).toBe(250);
    expect(venueTokenUnitsToNumber(WAD / 4n)).toBe(0.25);
  });
});

describe("poolPriceWadForSide", () => {
  it("prefers the live venue pool's display price", () => {
    const market = venueMarket();

    expect(poolPriceWadForSide(market, "yes")).toBe(880_000_000_000_000_000n);
    expect(poolPriceWadForSide(market, "no")).toBe(120_000_000_000_000_000n);
  });

  it("falls back to the headline cents price without a pool price", () => {
    const market = marketFactory({ noPriceCents: 36, yesPriceCents: 64 });

    expect(poolPriceWadForSide(market, "yes")).toBe(640_000_000_000_000_000n);
    expect(poolPriceWadForSide(market, "no")).toBe(360_000_000_000_000_000n);
  });
});

describe("estimateVenueSwapOutput", () => {
  it("estimates a buy: fee off the collateral, then convert at the price", () => {
    // 100 pUSD at 3000 pips fee leaves 99.7, at 0.5 pUSD/token = 199.4 tokens.
    const out = estimateVenueSwapOutput({
      action: "buy",
      amountIn: 100n * WAD,
      poolPriceWad: WAD / 2n,
    });

    expect(out).toBe((997n * WAD * 2n) / 10n);
  });

  it("estimates a sell: fee off the tokens, then convert at the price", () => {
    // 100 tokens at fee leaves 99.7, at 0.5 pUSD/token = 49.85 pUSD.
    const out = estimateVenueSwapOutput({
      action: "sell",
      amountIn: 100n * WAD,
      poolPriceWad: WAD / 2n,
    });

    expect(out).toBe((997n * WAD) / 20n);
  });

  it("returns zero for a non-positive pool price", () => {
    expect(
      estimateVenueSwapOutput({ action: "buy", amountIn: WAD, poolPriceWad: 0n })
    ).toBe(0n);
  });
});

describe("buildVenueSwapQuote", () => {
  it("prices a buy as collateral in per token out", () => {
    const quote = buildVenueSwapQuote({
      action: "buy",
      amountIn: 100n * WAD,
      amountOut: 200n * WAD,
      poolPriceWad: WAD / 2n,
      side: "yes",
      source: "quoter",
    });

    expect(quote.effectivePriceCents).toBeCloseTo(50, 10);
    expect(quote.poolPriceCents).toBeCloseTo(50, 10);
    expect(quote.side).toBe("yes");
    expect(quote.source).toBe("quoter");
  });

  it("prices a sell as collateral out per token in", () => {
    const quote = buildVenueSwapQuote({
      action: "sell",
      amountIn: 200n * WAD,
      amountOut: 90n * WAD,
      poolPriceWad: WAD / 2n,
      side: "no",
      source: "estimate",
    });

    expect(quote.effectivePriceCents).toBeCloseTo(45, 10);
    expect(quote.source).toBe("estimate");
  });

  it("falls back to the pool price when the token leg is zero", () => {
    const quote = buildVenueSwapQuote({
      action: "buy",
      amountIn: 100n * WAD,
      amountOut: 0n,
      poolPriceWad: (88n * WAD) / 100n,
      side: "yes",
      source: "estimate",
    });

    expect(quote.effectivePriceCents).toBeCloseTo(88, 10);
  });
});

function venueMarket() {
  return marketFactory({
    postgrad: {
      adapterAddress: "0x00000000000000000000000000000000000000ab",
      completeSets: 100,
      finalizedAt: "2026-07-01T00:00:00.000Z",
      marketAddress: "0x00000000000000000000000000000000000000cd",
      refundedUsd: 0,
      retainedUsd: 100,
      venue: {
        boundedHookAddress: "0x00000000000000000000000000000000000000f1",
        live: true,
        noPool: {
          displayPriceWad: "120000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x00000000000000000000000000000000000000f3",
          poolId: `0x${"22".repeat(32)}`,
          whitelisted: true,
        },
        orderManagerAddress: "0x00000000000000000000000000000000000000f2",
        poolManagerAddress: "0x00000000000000000000000000000000000000f0",
        yesPool: {
          displayPriceWad: "880000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x00000000000000000000000000000000000000f4",
          poolId: `0x${"11".repeat(32)}`,
          whitelisted: true,
        },
      },
    },
    status: "graduated",
  });
}
