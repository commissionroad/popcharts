import { describe, expect, it } from "vitest";

import type { Market } from "@/domain/markets/types";

import {
  buildReceiptQuotePreview,
  getReceiptAmountError,
  MAX_RECEIPT_BUDGET_USD,
  parseReceiptAmount,
} from "./receipt-quote";

const market: Market = {
  b: 5_000,
  category: "Crypto",
  closesAt: "2026-08-01T00:00:00.000Z",
  description: "Test market",
  graduationTargetUsd: 400_000,
  id: "test-market",
  matchedUsd: 0,
  noPriceCents: 40,
  openingProbability: 50,
  pricePath: [50],
  question: "Will the test pass?",
  receiptCount: 0,
  status: "bootstrap",
  volumeUsd: 0,
  yesPriceCents: 60,
};

describe("receipt quote preview", () => {
  it("derives provisional shares from a collateral budget", () => {
    const quote = buildReceiptQuotePreview({
      budgetUsd: 250,
      market,
      side: "yes",
    });

    expect(quote.budgetUsd).toBe(250);
    expect(quote.shares).toBeGreaterThan(0);
    expect(quote.averagePriceCents).toBeGreaterThan(60);
    expect(quote.maxCostUsd).toBeGreaterThan(250);
  });

  it("moves the selected side through an increasing side-price band", () => {
    const yesQuote = buildReceiptQuotePreview({
      budgetUsd: 100,
      market,
      side: "yes",
    });
    const noQuote = buildReceiptQuotePreview({
      budgetUsd: 100,
      market,
      side: "no",
    });

    expect(yesQuote.priceBand.fromProbability).toBeCloseTo(60, 6);
    expect(yesQuote.priceBand.toProbability).toBeGreaterThan(60);
    expect(noQuote.priceBand.fromProbability).toBeCloseTo(40, 6);
    expect(noQuote.priceBand.toProbability).toBeGreaterThan(40);
  });

  it("validates receipt amounts before quoting", () => {
    expect(parseReceiptAmount("250.50")).toBe(250.5);
    expect(parseReceiptAmount("abc")).toBeNull();
    expect(getReceiptAmountError("0")).toBe("Amount must be greater than zero.");
    expect(getReceiptAmountError(`${MAX_RECEIPT_BUDGET_USD + 1}`)).toBe(
      "Amount is above the current receipt limit."
    );
  });
});
