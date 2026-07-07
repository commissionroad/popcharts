import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlacedPregradReceipt } from "@/domain/pregrad-trading/receipt-quote";

import { PortfolioPage } from "./portfolio-page";

const useStoredReceipts = vi.hoisted(() => vi.fn());

vi.mock("@/features/receipt-ticket/receipt-storage", () => ({
  useStoredReceipts,
}));

beforeEach(() => {
  useStoredReceipts.mockReset();
  useStoredReceipts.mockReturnValue([]);
});

describe("PortfolioPage", () => {
  it("shows the empty state when no receipts are stored", () => {
    render(<PortfolioPage />);

    expect(screen.getByText("No open receipts")).toBeInTheDocument();
    expect(screen.getByText("Open receipts")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for graduation")).not.toBeInTheDocument();
  });

  it("lists stored receipts with side, band, and locked collateral totals", () => {
    useStoredReceipts.mockReturnValue([
      receiptFixture({
        collateralUsd: 150,
        id: "r-1",
        marketId: "31337:9",
        marketQuestion: "Will YES win?",
        receiptId: "12",
        side: "yes",
        transactionHash: `0x${"ab".repeat(32)}`,
      }),
      receiptFixture({
        collateralUsd: 50,
        id: "r-2",
        marketQuestion: "Will NO win?",
        receiptId: "13",
        side: "no",
      }),
    ]);

    render(<PortfolioPage />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("$200")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Will YES win?" })).toHaveAttribute(
      "href",
      "/markets/31337%3A9"
    );
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getByText("$150 receipt - #12")).toBeInTheDocument();
    expect(screen.getByText("$50.00 receipt - #13")).toBeInTheDocument();
    expect(screen.getAllByText("50%-54%")).toHaveLength(2);
    // Wallet-signed receipts note the on-chain hash; mock receipts do not.
    expect(screen.getByText("On-chain receipt")).toBeInTheDocument();
    expect(screen.getByText("Mock receipt")).toBeInTheDocument();
    expect(screen.queryByText("No open receipts")).not.toBeInTheDocument();
  });
});

function receiptFixture(
  overrides: Partial<PlacedPregradReceipt> = {}
): PlacedPregradReceipt {
  return {
    averagePriceCents: 52,
    collateralUsd: 100,
    createdAt: "2026-06-22T12:00:00.000Z",
    id: "receipt-1",
    marketId: "eth-5000-august",
    marketQuestion: "Will ETH flip $5,000 before August?",
    priceBand: { fromProbability: 50, toProbability: 54 },
    receiptId: "1",
    shares: 192,
    side: "yes",
    status: "waiting",
    ...overrides,
  };
}
