import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { MarketDetailPage } from "./market-detail-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/features/receipt-ticket/receipt-ticket", () => ({
  ReceiptTicket: ({ market }: { market: Market }) => (
    <div>Receipt ticket for {market.id}</div>
  ),
}));

vi.mock("@/features/postgrad-ticket/postgrad-ticket", () => ({
  PostgradTradePanel: ({ market }: { market: Market }) => (
    <div>Postgrad trade panel for {market.id}</div>
  ),
}));

vi.mock("@/features/order-book/order-book-card", () => ({
  OrderBookCard: ({ market }: { market: Market }) => (
    <div>Order book for {market.id}</div>
  ),
}));

vi.mock("./market-position-panel", () => ({
  MarketPositionPanel: ({ market }: { market: Market }) => (
    <div>Position panel for {market.id}</div>
  ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MarketDetailPage", () => {
  it("renders the market header, prices, metrics, and ticket", () => {
    const market = marketFactory({ noPriceCents: 36, yesPriceCents: 64 });
    delete market.aiReview;

    render(<MarketDetailPage market={market} />);

    expect(
      screen.getByRole("heading", { name: "Will ETH flip $5,000 before August?" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All markets/ })).toHaveAttribute(
      "href",
      "/"
    );
    // Prices render in both the header and the chart legend.
    expect(screen.getAllByText("64%")).not.toHaveLength(0);
    expect(screen.getAllByText("36%")).not.toHaveLength(0);
    expect(screen.getByText("Receipt ticket for eth-5000-august")).toBeInTheDocument();
    expect(screen.getByText("Receipts waiting")).toBeInTheDocument();
    expect(screen.getByText("Matched liquidity")).toBeInTheDocument();
    expect(screen.queryByText("AI review")).not.toBeInTheDocument();
  });

  it("renders the AI review card when the market has one", () => {
    render(<MarketDetailPage market={marketFactory()} />);

    expect(screen.getByText("AI review")).toBeInTheDocument();
  });

  it("renders pending review progress before a scorecard exists", () => {
    const market = marketFactory({ status: "under_review" });
    delete market.aiReview;
    market.aiReviewProgress = { phase: "running", status: "pending" };

    render(<MarketDetailPage market={market} />);

    expect(screen.getByText("Review pending")).toBeInTheDocument();
    expect(
      screen.getByText("Checking the market criteria and public evidence.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Objectivity")).not.toBeInTheDocument();
  });

  it("renders operator attention without a speculative scorecard", () => {
    const market = marketFactory({ status: "under_review" });
    delete market.aiReview;
    market.aiReviewProgress = {
      phase: "attention_required",
      status: "attention_required",
    };

    render(<MarketDetailPage market={market} />);

    expect(screen.getByText("Review delayed")).toBeInTheDocument();
    expect(screen.queryByText("Objectivity")).not.toBeInTheDocument();
  });

  it("prefers an explicit price path over the market's own", () => {
    render(
      <MarketDetailPage
        market={marketFactory()}
        pricePath={[{ cents: 10 }, { cents: 90 }]}
      />
    );

    expect(screen.getByText("Virtual LMSR - implied probability")).toBeInTheDocument();
  });

  it("links to graduation clearing while the market is graduating", () => {
    render(<MarketDetailPage market={marketFactory({ status: "graduating" })} />);

    expect(
      screen.getByRole("link", { name: /View graduation clearing/ })
    ).toHaveAttribute("href", "/markets/eth-5000-august/graduation");
    expect(screen.queryByText("Receipt book settled")).not.toBeInTheDocument();
  });

  it("summarizes minted tokens and refunds once the market graduated", () => {
    render(
      <MarketDetailPage
        market={marketFactory({
          matchedUsd: 356_000,
          status: "graduated",
          volumeUsd: 482_300,
        })}
      />
    );

    expect(screen.getByText("Receipt book settled")).toBeInTheDocument();
    expect(screen.getByText("YES tokens")).toBeInTheDocument();
    expect(screen.getAllByText("356,000")).not.toHaveLength(0);
    expect(screen.getByText("$126K")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /View graduation clearing/ })
    ).not.toBeInTheDocument();
  });

  it("retires the pre-graduation UI once the market graduated", () => {
    render(<MarketDetailPage market={marketFactory({ status: "graduated" })} />);

    // The receipt ticket, waiting-receipt metrics, and graduation progress
    // bar describe a receipt book that no longer accepts intents.
    expect(
      screen.queryByText("Receipt ticket for eth-5000-august")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Receipts waiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Matched liquidity")).not.toBeInTheDocument();
    expect(screen.queryByText("GRADUATION")).not.toBeInTheDocument();
    expect(screen.queryByText("READY TO GRADUATE")).not.toBeInTheDocument();
    // The chart still shows the pregrad path, labeled as history.
    expect(screen.getByText("Pre-graduation price history")).toBeInTheDocument();
    expect(
      screen.queryByText("Virtual LMSR - implied probability")
    ).not.toBeInTheDocument();
  });

  it("hands the graduated aside to the postgrad trade panel", () => {
    render(<MarketDetailPage market={marketFactory({ status: "graduated" })} />);

    expect(
      screen.getByText("Postgrad trade panel for eth-5000-august")
    ).toBeInTheDocument();
  });

  it("surfaces the user's position panel in the aside for either lifecycle", () => {
    const { rerender } = render(<MarketDetailPage market={marketFactory()} />);

    expect(screen.getByText("Position panel for eth-5000-august")).toBeInTheDocument();

    rerender(<MarketDetailPage market={marketFactory({ status: "graduated" })} />);

    expect(screen.getByText("Position panel for eth-5000-august")).toBeInTheDocument();
  });

  it("shows the order book only once the market graduated", () => {
    const { rerender } = render(<MarketDetailPage market={marketFactory()} />);

    expect(
      screen.queryByText("Order book for eth-5000-august")
    ).not.toBeInTheDocument();

    rerender(<MarketDetailPage market={marketFactory({ status: "graduated" })} />);

    expect(screen.getByText("Order book for eth-5000-august")).toBeInTheDocument();
  });

  it("shows the postgrad handoff without pools before the venue is wired", () => {
    render(
      <MarketDetailPage
        market={marketFactory({
          matchedUsd: 356_000,
          postgrad: {
            adapterAddress: "0x00000000000000000000000000000000000000ab",
            completeSets: 356_000,
            finalizedAt: "2026-07-01T00:00:00.000Z",
            marketAddress: "0x00000000000000000000000000000000000000cd",
            refundedUsd: 126_300,
            retainedUsd: 356_000,
          },
          status: "graduated",
          volumeUsd: 482_300,
        })}
      />
    );

    expect(screen.getByText("Receipt book settled")).toBeInTheDocument();
    expect(screen.getByText("Postgrad handoff")).toBeInTheDocument();
    expect(screen.queryByText("YES pool")).not.toBeInTheDocument();
    expect(screen.getByText(/refunds at its exact path cost/i)).toBeInTheDocument();
  });

  it("shows the live postgrad venue with pool ids once wired", () => {
    render(
      <MarketDetailPage
        market={marketFactory({
          matchedUsd: 356_000,
          postgrad: {
            adapterAddress: "0x00000000000000000000000000000000000000ab",
            completeSets: 356_000,
            finalizedAt: "2026-07-01T00:00:00.000Z",
            marketAddress: "0x00000000000000000000000000000000000000cd",
            refundedUsd: 126_300,
            retainedUsd: 356_000,
            venue: {
              boundedHookAddress: "0x00000000000000000000000000000000000000f1",
              live: true,
              noPool: {
                initialized: true,
                outcomeTokenAddress: "0x00000000000000000000000000000000000000f3",
                poolId: `0x${"22".repeat(32)}`,
                whitelisted: true,
              },
              orderManagerAddress: "0x00000000000000000000000000000000000000f2",
              poolManagerAddress: "0x00000000000000000000000000000000000000f0",
              yesPool: {
                initialized: true,
                outcomeTokenAddress: "0x00000000000000000000000000000000000000f4",
                poolId: `0x${"11".repeat(32)}`,
                whitelisted: true,
              },
            },
          },
          status: "graduated",
          volumeUsd: 482_300,
        })}
      />
    );

    expect(screen.getByText("Graduated - postgrad venue live")).toBeInTheDocument();
    expect(screen.getByText("YES pool")).toBeInTheDocument();
    expect(screen.getByText(`0x${"11".repeat(32)}`)).toBeInTheDocument();
    expect(
      screen.getByText(/trading continues on the bounded venue/i)
    ).toBeInTheDocument();
  });

  it("clamps graduated refunds to zero when matched exceeds volume", () => {
    render(
      <MarketDetailPage
        market={marketFactory({
          matchedUsd: 500_000,
          status: "graduated",
          volumeUsd: 400_000,
        })}
      />
    );

    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("offers graduation for an api-backed bootstrap market at target", () => {
    render(<MarketDetailPage market={graduatableMarket()} />);

    expect(screen.getByRole("button", { name: "Graduate market" })).toBeInTheDocument();
  });

  it.each([
    ["the market is not bootstrap", graduatableMarket({ status: "graduated" })],
    ["matched demand is below target", graduatableMarket({ matchedUsd: 1 })],
    ["the market has no chain id", offChainMarket()],
    [
      "the market id is not chain-prefixed",
      graduatableMarket({ id: "eth-5000-august" }),
    ],
  ])("hides the graduate action when %s", (_reason, market) => {
    render(<MarketDetailPage market={market} />);

    expect(
      screen.queryByRole("button", { name: "Graduate market" })
    ).not.toBeInTheDocument();
  });

  it("renders a market whose graduation target is zero without crashing", () => {
    render(<MarketDetailPage market={graduatableMarket({ graduationTargetUsd: 0 })} />);

    expect(screen.getByText("/ target pending")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Graduate market" })
    ).not.toBeInTheDocument();
  });
});

function offChainMarket(): Market {
  const market = graduatableMarket();
  delete market.chainId;

  return market;
}

function graduatableMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    chainId: 31337,
    graduationTargetUsd: 1_000,
    id: "31337:9",
    matchedUsd: 1_500,
    status: "bootstrap",
    ...overrides,
  });
}
