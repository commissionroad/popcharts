import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  PlacedPregradReceipt,
  ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";

import {
  CollateralBalancePanel,
  PlacedReceiptNotice,
  QuotePreview,
} from "./receipt-ticket-panels";

describe("CollateralBalancePanel", () => {
  it("shows the formatted balance without a faucet by default", () => {
    render(balancePanel({ balanceUsd: 1_250 }));

    expect(screen.getByText("pUSD balance")).toBeInTheDocument();
    expect(screen.getByText("1,250 pUSD")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prompts to connect before showing a balance", () => {
    render(balancePanel({ walletConnected: false }));

    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
  });

  it("offers the faucet and mints on click", () => {
    const onMint = vi.fn();

    render(balancePanel({ canMint: true, onMint }));

    const mint = screen.getByRole("button", { name: /Mint test pUSD/ });

    expect(mint).toBeEnabled();

    fireEvent.click(mint);

    expect(onMint).toHaveBeenCalledTimes(1);
  });

  it("disables the faucet while a mint is in flight", () => {
    render(balancePanel({ canMint: true, isMinting: true }));

    expect(screen.getByRole("button", { name: /Mint test pUSD/ })).toBeDisabled();
  });
});

describe("QuotePreview", () => {
  it("renders placeholder dashes without a quote", () => {
    render(<QuotePreview quote={null} sideColor="var(--yes)" />);

    expect(screen.getByText("Avg price")).toBeInTheDocument();
    expect(screen.getAllByText("--")).toHaveLength(5);
  });

  it("breaks down the quote rows", () => {
    render(<QuotePreview quote={quoteFixture()} sideColor="var(--yes)" />);

    expect(screen.getByText("52c")).toBeInTheDocument();
    expect(screen.getByText("192 sh")).toBeInTheDocument();
    expect(screen.getByText("50% to 54%")).toBeInTheDocument();
    expect(screen.getByText("+4.00 pts")).toBeInTheDocument();
    expect(screen.getByText("$102")).toBeInTheDocument();
  });

  it("tones the price impact once it reaches five points", () => {
    render(
      <QuotePreview
        quote={quoteFixture({ priceImpactCents: 6.5 })}
        sideColor="var(--yes)"
      />
    );

    expect(screen.getByText("+6.50 pts")).toHaveStyle({
      color: "var(--status-graduating)",
    });
  });
});

describe("PlacedReceiptNotice", () => {
  it("confirms the placed receipt with its transaction hash", () => {
    render(
      <PlacedReceiptNotice
        receipt={receiptFixture({ transactionHash: `0x${"ab".repeat(32)}` })}
      />
    );

    expect(screen.getByText("Receipt placed")).toBeInTheDocument();
    expect(screen.getByText("#7 - $100 - 192 sh")).toBeInTheDocument();
    expect(screen.getByText(/^Tx 0xaba\.\.\.bab$/)).toBeInTheDocument();
  });

  it("omits the transaction line for mock receipts", () => {
    render(<PlacedReceiptNotice receipt={receiptFixture()} />);

    expect(screen.queryByText(/^Tx /)).not.toBeInTheDocument();
  });
});

function balancePanel(
  overrides: Partial<Parameters<typeof CollateralBalancePanel>[0]> = {}
) {
  return (
    <CollateralBalancePanel
      balanceUsd={1_250}
      canMint={false}
      error={null}
      isLoading={false}
      isMinting={false}
      onMint={vi.fn()}
      walletConnected
      {...overrides}
    />
  );
}

function quoteFixture(
  overrides: Partial<ReceiptQuotePreview> = {}
): ReceiptQuotePreview {
  return {
    averagePriceCents: 52,
    budgetUsd: 100,
    maxCostUsd: 101.5,
    priceBand: { fromProbability: 50, toProbability: 54 },
    priceImpactCents: 4,
    shares: 192,
    side: "yes",
    ...overrides,
  };
}

function receiptFixture(
  overrides: Partial<PlacedPregradReceipt> = {}
): PlacedPregradReceipt {
  return {
    averagePriceCents: 52,
    collateralUsd: 100,
    createdAt: "2026-06-22T12:00:00.000Z",
    id: "receipt-1",
    marketId: "31337:9",
    marketQuestion: "Will it pop?",
    priceBand: { fromProbability: 50, toProbability: 54 },
    receiptId: "7",
    shares: 192,
    side: "yes",
    status: "waiting",
    ...overrides,
  };
}
