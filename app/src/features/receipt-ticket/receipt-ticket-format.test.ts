import { describe, expect, it } from "vitest";

import type { ReceiptQuotePreview } from "@/domain/pregrad-trading/receipt-quote";

import {
  formatPlacementStep,
  formatPresetAmount,
  formatPriceBand,
  formatPusdBalance,
  formatShares,
} from "./receipt-ticket-format";

describe("formatPusdBalance", () => {
  it("prefers the connect prompt over every other state", () => {
    expect(
      formatPusdBalance({
        balanceUsd: 250,
        error: "read failed",
        isLoading: true,
        walletConnected: false,
      })
    ).toBe("Connect wallet");
  });

  it("shows loading before surfacing an error", () => {
    expect(
      formatPusdBalance({
        balanceUsd: null,
        error: "read failed",
        isLoading: true,
        walletConnected: true,
      })
    ).toBe("Loading...");
  });

  it("reports unavailable when the balance read failed", () => {
    expect(
      formatPusdBalance({
        balanceUsd: 250,
        error: "read failed",
        isLoading: false,
        walletConnected: true,
      })
    ).toBe("Unavailable");
  });

  it("renders a placeholder when no balance has loaded", () => {
    expect(
      formatPusdBalance({
        balanceUsd: null,
        error: null,
        isLoading: false,
        walletConnected: true,
      })
    ).toBe("--");
  });

  it("shows cents only for balances under 100", () => {
    expect(balanceOf(42.5)).toBe("42.50 pUSD");
    expect(balanceOf(1_234.56)).toBe("1,235 pUSD");
  });

  it("renders a zero balance without forced cents", () => {
    expect(balanceOf(0)).toBe("0 pUSD");
  });
});

describe("formatPlacementStep", () => {
  it.each([
    ["approving", "Approving pUSD spend..."],
    ["confirming", "Waiting for confirmation..."],
    ["minting", "Minting local test pUSD..."],
    ["placing", "Submitting receipt..."],
    ["quoting", "Refreshing chain quote..."],
  ] as const)("labels the %s step", (step, label) => {
    expect(formatPlacementStep(step)).toBe(label);
  });
});

describe("formatPriceBand", () => {
  it("renders the probability range the receipt walks", () => {
    expect(formatPriceBand(quoteWithBand(48.4, 53.6))).toBe("48% to 54%");
  });
});

describe("formatShares", () => {
  it("drops decimals from 1,000 shares up", () => {
    expect(formatShares(1_000)).toBe("1,000");
    expect(formatShares(12_345.67)).toBe("12,346");
  });

  it("keeps up to two decimals below 1,000", () => {
    expect(formatShares(999.994)).toBe("999.99");
    expect(formatShares(0.5)).toBe("0.5");
    expect(formatShares(0)).toBe("0");
  });
});

describe("formatPresetAmount", () => {
  it("floors to whole dollars from 100 up", () => {
    expect(formatPresetAmount(100)).toBe("100");
    expect(formatPresetAmount(2_499.99)).toBe("2499");
  });

  it("trims trailing zeros below 100", () => {
    expect(formatPresetAmount(99.5)).toBe("99.5");
    expect(formatPresetAmount(25)).toBe("25");
    expect(formatPresetAmount(0.25)).toBe("0.25");
  });
});

function balanceOf(balanceUsd: number) {
  return formatPusdBalance({
    balanceUsd,
    error: null,
    isLoading: false,
    walletConnected: true,
  });
}

function quoteWithBand(
  fromProbability: number,
  toProbability: number
): ReceiptQuotePreview {
  return {
    averagePriceCents: 50,
    budgetUsd: 100,
    maxCostUsd: 101.5,
    priceBand: { fromProbability, toProbability },
    priceImpactCents: 4,
    shares: 200,
    side: "yes",
  };
}
