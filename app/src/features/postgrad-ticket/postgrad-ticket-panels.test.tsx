import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VenueSwapQuote } from "@/domain/postgrad-trading/venue-trade";

import type { VenueLimitOrderReceipt } from "./limit-order-service";
import type { VenueSwapReceipt } from "./postgrad-swap-service";
import {
  CompletedLimitOrderNotice,
  CompletedSwapNotice,
  LimitOrderPreview,
  SwapQuotePreview,
  VenueBalancesPanel,
} from "./postgrad-ticket-panels";

const WAD = 10n ** 18n;

describe("VenueBalancesPanel", () => {
  it("shows collateral and both outcome token balances", () => {
    render(
      <VenueBalancesPanel
        balances={{ collateral: 1_200, error: null, loading: false, no: 3, yes: 60 }}
        noLabel="NO"
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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

describe("LimitOrderPreview", () => {
  it("previews a bid: deposits collateral, receives tokens if filled", () => {
    render(
      <LimitOrderPreview
        quote={{
          depositWad: 30n * WAD,
          direction: "bid",
          priceCents: 30,
          sizeWad: 100n * WAD,
        }}
        sideColor="var(--yes)"
      />
    );

    expect(screen.getByText("30.0c")).toBeInTheDocument();
    expect(screen.getByText("You deposit")).toBeInTheDocument();
    expect(screen.getByText("30 pUSD")).toBeInTheDocument();
    expect(screen.getByText("If filled you receive")).toBeInTheDocument();
    // Size row and the if-filled row both read 100 tok for a bid.
    expect(screen.getAllByText("100 tok")).toHaveLength(2);
  });

  it("previews an ask: escrows tokens, receives collateral if filled", () => {
    render(
      <LimitOrderPreview
        quote={{
          depositWad: 100n * WAD,
          direction: "ask",
          priceCents: 95,
          sizeWad: 100n * WAD,
        }}
        sideColor="var(--no)"
      />
    );

    expect(screen.getByText("You escrow")).toBeInTheDocument();
    // Size row and the escrow row both read 100 tok for an ask.
    expect(screen.getAllByText("100 tok")).toHaveLength(2);
    // 100 tokens at 95c fill into 95 pUSD.
    expect(screen.getByText("95 pUSD")).toBeInTheDocument();
  });

  it("renders placeholder dashes without a validated quote", () => {
    render(<LimitOrderPreview quote={null} sideColor="var(--yes)" />);

    expect(screen.getAllByText("--")).toHaveLength(4);
    // Without a quote the deposit row defaults to the escrow label.
    expect(screen.getByText("You escrow")).toBeInTheDocument();
  });
});

describe("CompletedLimitOrderNotice", () => {
  it("summarizes a resting bid with its order id and hash", () => {
    render(
      <CompletedLimitOrderNotice noLabel="NO" order={restingBid()} yesLabel="YES" />
    );

    expect(screen.getByText("Limit order placed")).toBeInTheDocument();
    expect(screen.getByText("Buy 100 YES tokens at 30.0c")).toBeInTheDocument();
    expect(screen.getByText(/order #9/)).toBeInTheDocument();
    expect(screen.getByText(/Tx 0xccc/)).toBeInTheDocument();
  });

  it("summarizes a resting ask on the NO side", () => {
    render(
      <CompletedLimitOrderNotice
        noLabel="NO"
        order={{ ...restingBid(), direction: "ask", priceCents: 95, side: "no" }}
        yesLabel="YES"
      />
    );

    expect(screen.getByText("Sell 100 NO tokens at 95.0c")).toBeInTheDocument();
  });
});

function restingBid(): VenueLimitOrderReceipt {
  return {
    amountIn: 30n * WAD,
    direction: "bid",
    orderId: 9,
    priceCents: 30,
    side: "yes",
    sizeWad: 100n * WAD,
    transactionHash: `0x${"cc".repeat(32)}`,
  };
}

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
