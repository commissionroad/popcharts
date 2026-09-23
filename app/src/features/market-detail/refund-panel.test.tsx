import type { Portfolio, PortfolioReceipt } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { marketFactory } from "@/test/factories/markets";

import { RefundPanel } from "./refund-panel";

const usePortfolio = vi.hoisted(() => vi.fn());
const useWalletAccount = vi.hoisted(() => vi.fn());
const useRefundClaim = vi.hoisted(() => vi.fn());

vi.mock("@/features/portfolio/use-portfolio", () => ({ usePortfolio }));

vi.mock("@/integrations/wallet/wallet-provider", () => ({ useWalletAccount }));

vi.mock("@/integrations/contracts/hooks/use-refund-claim", () => ({ useRefundClaim }));

const OWNER = "0x1111111111111111111111111111111111111111";

function closedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    closesAt: "2026-08-14T00:00:00.000Z",
    graduationTargetUsd: 12_500,
    id: "31337:7",
    matchedUsd: 3_140,
    outcomeNo: "NO",
    outcomeYes: "YES",
    status: "refunded",
    ...overrides,
  });
}

function receipt(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    marketStatus: "refunded",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: "0",
    priceBandLow: "0",
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "refund_claimable",
    ...overrides,
  };
}

function portfolioFixture(receipts: PortfolioReceipt[] = [receipt()]): Portfolio {
  return {
    chainId: 31337,
    openOrders: [],
    owner: OWNER,
    positions: [],
    receipts,
    redemptions: [],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: "0",
      openOrderCount: 0,
      openReceiptCount: 0,
      positionCount: 0,
      totalPositionValueWad: "0",
    },
  };
}

beforeEach(() => {
  useWalletAccount.mockReset();
  useWalletAccount.mockReturnValue({ address: OWNER });
  usePortfolio.mockReset();
  usePortfolio.mockReturnValue({
    error: null,
    loading: false,
    portfolio: portfolioFixture(),
    refresh: vi.fn(),
  });
  useRefundClaim.mockReset();
  useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "idle" });
});

describe("RefundPanel visibility", () => {
  it("renders nothing for a market that did not close without graduating", () => {
    const { container } = render(
      <RefundPanel market={closedMarket({ status: "graduated" })} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a market id it cannot parse", () => {
    const { container } = render(<RefundPanel market={closedMarket({ id: "nope" })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a connected wallet", () => {
    useWalletAccount.mockReturnValue({ address: null });

    const { container } = render(<RefundPanel market={closedMarket()} />);

    expect(container).toBeEmptyDOMElement();
    expect(usePortfolio).toHaveBeenCalledWith({
      chainId: configuredPopChartsChainId,
      owner: null,
    });
  });

  it("renders nothing before the portfolio loads", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: true,
      portfolio: null,
      refresh: vi.fn(),
    });

    const { container } = render(<RefundPanel market={closedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a viewer who never held a receipt here", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([]),
      refresh: vi.fn(),
    });

    const { container } = render(<RefundPanel market={closedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("ignores receipts belonging to another market", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([receipt({ marketId: "9" })]),
      refresh: vi.fn(),
    });

    const { container } = render(<RefundPanel market={closedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("RefundPanel claim", () => {
  it("states why the market ended and what the escrow returns", () => {
    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByText("Refund available")).toBeInTheDocument();
    expect(screen.getByText(/closed without reaching graduation/)).toBeInTheDocument();
    expect(screen.getByText("Refund")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim $60.00" })).toBeInTheDocument();
  });

  it("splits escrow from the returned entry fee when the paid fee is known", () => {
    render(
      <RefundPanel
        entryFees={{ "11": ((60n * WAD) / 100n).toString() }}
        market={closedMarket()}
      />
    );

    expect(screen.getByText("Escrowed cost")).toBeInTheDocument();
    expect(screen.getByText("Entry fee returned")).toBeInTheDocument();
    expect(screen.getByText("$0.60")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim $60.60" })).toBeInTheDocument();
  });

  it("names the cancellation instead when the owner withdrew the market", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([receipt({ marketStatus: "cancelled" })]),
      refresh: vi.fn(),
    });

    render(<RefundPanel market={closedMarket({ status: "cancelled" })} />);

    expect(screen.getByText(/owner cancelled this market/)).toBeInTheDocument();
  });

  it("claims the receipt the button belongs to", () => {
    const claim = vi.fn();
    useRefundClaim.mockReturnValue({ claim, error: null, status: "idle" });

    render(<RefundPanel market={closedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "Claim $60.00" }));

    expect(claim).toHaveBeenCalledWith("11");
  });

  it("gives each receipt its own amount, id and button", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([
        receipt({ receiptId: "11" }),
        receipt({ cost: (24n * WAD).toString(), receiptId: "12", side: "no" }),
      ]),
      refresh: vi.fn(),
    });

    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByText("#11")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim $60.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim $24.00" })).toBeInTheDocument();
    // The market-level total is what the ending is worth, across both receipts.
    expect(screen.getByText("$84.00")).toBeInTheDocument();
  });

  it("locks the button out of action while a claim is in flight", () => {
    useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "pending" });

    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByRole("button", { name: /Claiming refund/ })).toBeDisabled();
  });

  it("locks the button after a confirmed claim, before the indexer catches up", () => {
    useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "success" });

    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByRole("button", { name: "Refund claimed" })).toBeDisabled();
  });

  it("keeps a failed claim retryable on the same button and shows the reason", () => {
    useRefundClaim.mockReturnValue({
      claim: vi.fn(),
      error: "The refund claim was reverted.",
      status: "error",
    });

    render(<RefundPanel market={closedMarket()} />);

    const retry = screen.getByRole("button", { name: /Try again — claim \$60\.00/ });

    expect(retry).toBeEnabled();
    expect(screen.getByText("The refund claim was reverted.")).toBeInTheDocument();
  });

  it("becomes a record of what was returned once everything is claimed", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([
        receipt({
          settlement: {
            claimedAt: "2026-08-16T00:00:00.000Z",
            refund: (60n * WAD).toString(),
          },
          status: "refunded",
        }),
      ]),
      refresh: vi.fn(),
    });

    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByText("Refund claimed")).toBeInTheDocument();
    expect(
      screen.getByText(/\$60\.00 already returned across 1 claimed receipt\./)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("pluralises the claimed-receipt record", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture([
        receipt({ receiptId: "11", status: "refunded" }),
        receipt({ receiptId: "12", status: "refunded" }),
      ]),
      refresh: vi.fn(),
    });

    render(<RefundPanel market={closedMarket()} />);

    expect(screen.getByText(/across 2 claimed receipts\./)).toBeInTheDocument();
  });

  it("refreshes the portfolio once a claim confirms", () => {
    const refresh = vi.fn();
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture(),
      refresh,
    });

    render(<RefundPanel market={closedMarket()} />);

    expect(useRefundClaim).toHaveBeenCalledWith({ onClaimed: refresh });
  });
});
