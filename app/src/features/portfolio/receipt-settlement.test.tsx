import type { PortfolioReceipt } from "@popcharts/api-client/models";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReceiptSettlement, receiptSettlementResult } from "./receipt-settlement";

const WAD = 10n ** 18n;

function receiptFixture(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    marketStatus: "bootstrap",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: "620000000000000000",
    priceBandLow: "550000000000000000",
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "awaiting_graduation",
    ...overrides,
  };
}

describe("receiptSettlementResult", () => {
  it("shows retained tokens plus a partial refund for a settled receipt", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({
          settlement: {
            claimedAt: "2026-07-08T00:00:00.000Z",
            refund: (25n * WAD).toString(),
            retainedCost: (35n * WAD).toString(),
            retainedShares: (58n * WAD).toString(),
          },
          status: "settled",
        })
      )
    ).toEqual({
      detail: "58.00 YES tokens + $25.00 refunded",
      label: "Settled",
    });
  });

  it("omits the refund note when a settled receipt was fully filled", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({
          settlement: {
            claimedAt: "2026-07-08T00:00:00.000Z",
            refund: "0",
            retainedCost: (60n * WAD).toString(),
            retainedShares: (100n * WAD).toString(),
          },
          status: "settled",
        })
      )
    ).toEqual({ detail: "100 YES tokens", label: "Settled" });
  });

  it("renders zero tokens when a settled claim omits retainedShares", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({
          settlement: { claimedAt: "2026-07-08T00:00:00.000Z", refund: "0" },
          status: "settled",
        })
      )
    ).toEqual({ detail: "0 YES tokens", label: "Settled" });
  });

  it("uses the receipt side in the retained-token label", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({
          settlement: {
            claimedAt: "2026-07-08T00:00:00.000Z",
            refund: "0",
            retainedShares: (40n * WAD).toString(),
          },
          side: "no",
          status: "settled",
        })
      )
    ).toEqual({ detail: "40.00 NO tokens", label: "Settled" });
  });

  it("shows the amount returned for a claimed refund", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({
          settlement: {
            claimedAt: "2026-07-08T00:00:00.000Z",
            refund: (60n * WAD).toString(),
          },
          status: "refunded",
        })
      )
    ).toEqual({ detail: "$60.00 returned", label: "Refunded" });
  });

  it("points a graduated, claimable receipt at the market page", () => {
    expect(receiptSettlementResult(receiptFixture({ status: "claimable" }))).toEqual({
      detail: "Ready to claim on the market page",
      label: "Graduated",
    });
  });

  it("shows the escrowed cost as the amount and points at the market page", () => {
    expect(
      receiptSettlementResult(
        receiptFixture({ cost: (24n * WAD).toString(), status: "refund_claimable" })
      )
    ).toEqual({
      detail: "Claim on the market page",
      label: "$24.00 refund available",
    });
  });

  it("falls back to waiting while a receipt is still pre-graduation", () => {
    expect(
      receiptSettlementResult(receiptFixture({ status: "awaiting_graduation" }))
    ).toEqual({ label: "Waiting for graduation" });
  });

  it("falls back to waiting when a terminal status is missing its settlement", () => {
    // Defensive: the indexer always pairs these statuses with a settlement, but
    // the component must not throw if one is absent.
    expect(receiptSettlementResult(receiptFixture({ status: "settled" }))).toEqual({
      label: "Waiting for graduation",
    });
    expect(receiptSettlementResult(receiptFixture({ status: "refunded" }))).toEqual({
      label: "Waiting for graduation",
    });
  });
});

describe("ReceiptSettlement", () => {
  it("renders the headline and detail line", () => {
    render(
      <ReceiptSettlement
        receipt={receiptFixture({
          settlement: {
            claimedAt: "2026-07-08T00:00:00.000Z",
            refund: (25n * WAD).toString(),
            retainedShares: (58n * WAD).toString(),
          },
          status: "settled",
        })}
      />
    );

    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByText("58.00 YES tokens + $25.00 refunded")).toBeInTheDocument();
  });

  it("renders the headline alone when there is no detail", () => {
    render(
      <ReceiptSettlement receipt={receiptFixture({ status: "awaiting_graduation" })} />
    );

    expect(screen.getByText("Waiting for graduation")).toBeInTheDocument();
  });
});
