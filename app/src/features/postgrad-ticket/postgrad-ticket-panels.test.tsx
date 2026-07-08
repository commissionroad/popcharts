import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VenueSwapQuote } from "@/domain/postgrad-trading/venue-trade";

import type { VenueSwapReceipt } from "./postgrad-swap-service";
import {
  CompletedSwapNotice,
  SwapQuotePreview,
  VenueBalancesPanel,
} from "./postgrad-ticket-panels";

const WAD = 10n ** 18n;

describe("VenueBalancesPanel", () => {
  it("shows collateral and both outcome token balances", () => {
    render(
      <VenueBalancesPanel
        balances={{ collateral: 1_200, error: null, loading: false, no: 3, yes: 60 }}
        canMint
        isMinting={false}
        noLabel="NO"
        onMint={vi.fn()}
        walletConnected
        yesLabel="YES"
      />
    );

    expect(screen.getByText("pUSD")).toBeInTheDocument();
    expect(screen.getByText("1,200 pUSD")).toBeInTheDocument();
    expect(screen.getByText("YES tokens")).toBeInTheDocument();
    expect(screen.getByText("60.00 tok")).toBeInTheDocument();
    expect(screen.getByText("NO tokens")).toBeInTheDocument();
    expect(screen.getByText("3.00 tok")).toBeInTheDocument();
  });

  it("mints test pUSD from the faucet button", () => {
    const onMint = vi.fn();
    render(
      <VenueBalancesPanel
        balances={{ collateral: 0, error: null, loading: false, no: 0, yes: 0 }}
        canMint
        isMinting={false}
        noLabel="NO"
        onMint={onMint}
        walletConnected
        yesLabel="YES"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Mint test pUSD/ }));

    expect(onMint).toHaveBeenCalledTimes(1);
  });

  it("disables the faucet while minting and hides it when unavailable", () => {
    const { rerender } = render(
      <VenueBalancesPanel
        balances={{ collateral: 0, error: null, loading: false, no: 0, yes: 0 }}
        canMint
        isMinting
        noLabel="NO"
        onMint={vi.fn()}
        walletConnected
        yesLabel="YES"
      />
    );

    expect(screen.getByRole("button", { name: /Mint test pUSD/ })).toBeDisabled();

    rerender(
      <VenueBalancesPanel
        balances={{ collateral: 0, error: null, loading: false, no: 0, yes: 0 }}
        canMint={false}
        isMinting={false}
        noLabel="NO"
        onMint={vi.fn()}
        walletConnected
        yesLabel="YES"
      />
    );

    expect(
      screen.queryByRole("button", { name: /Mint test pUSD/ })
    ).not.toBeInTheDocument();
  });
});

describe("SwapQuotePreview", () => {
  it("renders a buy quote with the venue quoter source", () => {
    render(
      <SwapQuotePreview
        quote={buyQuote()}
        quoteLoading={false}
        sideColor="var(--yes)"
      />
    );

    expect(screen.getByText("You spend")).toBeInTheDocument();
    expect(screen.getByText("250 pUSD")).toBeInTheDocument();
    expect(screen.getByText("Est. tokens out")).toBeInTheDocument();
    expect(screen.getByText("500 tok")).toBeInTheDocument();
    expect(screen.getByText("50.0c")).toBeInTheDocument();
    expect(screen.getByText("48.0c")).toBeInTheDocument();
    expect(screen.getByText("Venue quoter")).toBeInTheDocument();
  });

  it("renders a sell quote labeled as an estimate", () => {
    render(
      <SwapQuotePreview
        quote={{
          ...buyQuote(),
          action: "sell",
          amountIn: 500n * WAD,
          amountOut: 240n * WAD,
          source: "estimate",
        }}
        quoteLoading={false}
        sideColor="var(--no)"
      />
    );

    expect(screen.getByText("You sell")).toBeInTheDocument();
    expect(screen.getByText("500 tok")).toBeInTheDocument();
    expect(screen.getByText("Est. pUSD out")).toBeInTheDocument();
    expect(screen.getByText("240 pUSD")).toBeInTheDocument();
    expect(screen.getByText("Estimated from pool price")).toBeInTheDocument();
  });

  it("renders dashes without a quote and a refreshing hint while loading", () => {
    const { rerender } = render(
      <SwapQuotePreview quote={null} quoteLoading={false} sideColor="var(--yes)" />
    );

    expect(screen.getAllByText("--")).toHaveLength(5);

    rerender(<SwapQuotePreview quote={null} quoteLoading sideColor="var(--yes)" />);

    expect(screen.getByText("Refreshing...")).toBeInTheDocument();
  });
});

describe("CompletedSwapNotice", () => {
  it("summarizes a full buy fill with the transaction hash", () => {
    render(<CompletedSwapNotice noLabel="NO" swap={buyFill()} yesLabel="YES" />);

    expect(screen.getByText("Order filled")).toBeInTheDocument();
    expect(screen.getByText("Bought 500 YES tokens for 250 pUSD")).toBeInTheDocument();
    expect(screen.getByText(/Tx 0xbbb/)).toBeInTheDocument();
    expect(screen.queryByText(/Partially filled/)).not.toBeInTheDocument();
  });

  it("summarizes a sell fill", () => {
    render(
      <CompletedSwapNotice
        noLabel="NO"
        swap={{
          ...buyFill(),
          action: "sell",
          amountIn: 500n * WAD,
          amountOut: 240n * WAD,
          side: "no",
        }}
        yesLabel="YES"
      />
    );

    expect(screen.getByText("Sold 500 NO tokens for 240 pUSD")).toBeInTheDocument();
  });

  it("calls out partial fills at the price bound", () => {
    render(
      <CompletedSwapNotice
        noLabel="NO"
        swap={{ ...buyFill(), partialFill: true }}
        yesLabel="YES"
      />
    );

    expect(screen.getByText(/Partially filled/)).toBeInTheDocument();
    expect(screen.getByText(/reached its price bound/)).toBeInTheDocument();
  });
});

function buyQuote(): VenueSwapQuote {
  return {
    action: "buy",
    amountIn: 250n * WAD,
    amountOut: 500n * WAD,
    effectivePriceCents: 50,
    poolPriceCents: 48,
    side: "yes",
    source: "quoter",
  };
}

function buyFill(): VenueSwapReceipt {
  return {
    action: "buy",
    amountIn: 250n * WAD,
    amountOut: 500n * WAD,
    partialFill: false,
    requestedIn: 250n * WAD,
    side: "yes",
    transactionHash: `0x${"bb".repeat(32)}`,
  };
}
