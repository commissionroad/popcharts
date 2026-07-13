import type {
  Portfolio,
  PortfolioOpenOrder,
  PortfolioPosition,
  PortfolioReceipt,
} from "@popcharts/api-client/models";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { configuredPopChartsChainId } from "@/integrations/contracts/config";

import { PortfolioPage } from "./portfolio-page";

const usePortfolio = vi.hoisted(() => vi.fn());
const useWalletAccount = vi.hoisted(() => vi.fn());

vi.mock("./use-portfolio", () => ({ usePortfolio }));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount,
}));

const OWNER = "0x1111111111111111111111111111111111111111";
const WAD = 10n ** 18n;

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
});

describe("PortfolioPage wallet and load states", () => {
  it("prompts to connect when no wallet is present", () => {
    useWalletAccount.mockReturnValue({ address: null });

    render(<PortfolioPage />);

    expect(screen.getByText("No wallet connected")).toBeInTheDocument();
    expect(usePortfolio).toHaveBeenCalledWith({
      chainId: configuredPopChartsChainId,
      owner: null,
    });
  });

  it("shows the loading notice before the first read settles", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: true,
      portfolio: null,
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("Loading portfolio")).toBeInTheDocument();
  });

  it("shows the error notice when the read fails", () => {
    usePortfolio.mockReturnValue({
      error: "Could not load your portfolio.",
      loading: false,
      portfolio: null,
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("Portfolio unavailable")).toBeInTheDocument();
    expect(screen.getByText("Could not load your portfolio.")).toBeInTheDocument();
  });

  it("shows section empty states for a wallet with no activity", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        openOrders: [],
        positions: [],
        receipts: [],
        summary: summaryFixture({
          openReceiptCount: 0,
          positionCount: 0,
        }),
      }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("No receipts")).toBeInTheDocument();
    expect(screen.getByText("No backed positions")).toBeInTheDocument();
    expect(screen.queryByText("Open orders")).not.toBeInTheDocument();
  });
});

describe("PortfolioPage summary cards", () => {
  it("renders real counts and locked collateral", () => {
    render(<PortfolioPage />);

    expect(screen.getByText("Open receipts")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("$150")).toBeInTheDocument();
    // The label appears on the metric card and as the section heading.
    expect(screen.getAllByText("Backed positions").length).toBeGreaterThan(0);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("PortfolioPage receipts", () => {
  it("links each receipt to its market and shows cost and average price", () => {
    render(<PortfolioPage />);

    // Receipts, positions, and orders all link the same market fixture.
    const links = screen.getAllByRole("link", { name: "Will it pop?" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute(
        "href",
        `/markets/${encodeURIComponent(`${configuredPopChartsChainId}:7`)}`
      );
    }
    expect(screen.getByText("$60.00 receipt - #11")).toBeInTheDocument();
    // 60 cost / 100 shares = 60c average.
    expect(screen.getByText("60c")).toBeInTheDocument();
  });

  it("renders every lifecycle status", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        receipts: [
          receiptFixture({ receiptId: "1", status: "awaiting_graduation" }),
          receiptFixture({ receiptId: "2", status: "claimable" }),
          receiptFixture({ receiptId: "3", status: "refund_claimable" }),
          receiptFixture({
            receiptId: "4",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (25n * WAD).toString(),
              retainedCost: (35n * WAD).toString(),
              retainedShares: (58n * WAD).toString(),
            },
            status: "settled",
          }),
          receiptFixture({
            receiptId: "5",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (60n * WAD).toString(),
            },
            side: "no",
            status: "refunded",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("Waiting for graduation")).toBeInTheDocument();
    expect(screen.getByText("Graduated")).toBeInTheDocument();
    expect(screen.getByText("Ready to claim on the market page")).toBeInTheDocument();
    // A full refund shows its amount and keeps the market-page pointer.
    expect(screen.getByText("$60.00 refund available")).toBeInTheDocument();
    expect(screen.getByText("Claim on the market page")).toBeInTheDocument();
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByText("58.00 YES tokens + $25.00 refunded")).toBeInTheDocument();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("$60.00 returned")).toBeInTheDocument();
  });

  it("omits the refund note for settled receipts without a refund", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        receipts: [
          receiptFixture({
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: "0",
              retainedCost: (35n * WAD).toString(),
              retainedShares: (58n * WAD).toString(),
            },
            status: "settled",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("58.00 YES tokens")).toBeInTheDocument();
    expect(screen.queryByText(/refunded/)).not.toBeInTheDocument();
  });

  it("renders zero tokens when a settled claim omits retainedShares", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        receipts: [
          receiptFixture({
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: "0",
            },
            status: "settled",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("0 YES tokens")).toBeInTheDocument();
  });

  it("falls back to the market id when the question is missing and dashes a zero-share average", () => {
    const receipt = receiptFixture({ shares: "0" });
    delete receipt.marketQuestion;
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ receipts: [receipt] }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByRole("link", { name: "Market #7" })).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});

describe("PortfolioPage positions", () => {
  it("shows held, committed, owned, value, price, and average cost", () => {
    render(<PortfolioPage />);

    // Held 40, in orders 100, owned 140.
    expect(screen.getByText("40.00")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("140")).toBeInTheDocument();
    expect(screen.getByText("$84.00")).toBeInTheDocument();
    expect(screen.getByText("at 60c")).toBeInTheDocument();
    expect(screen.getByText("avg cost 55c")).toBeInTheDocument();
  });

  it("dashes the value when the pool has no price", () => {
    const position = positionFixture({});
    delete position.avgCostWad;
    delete position.currentValueWad;
    delete position.poolPriceWad;
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ positions: [position] }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.queryByText(/^at /)).not.toBeInTheDocument();
    expect(screen.queryByText(/avg cost/)).not.toBeInTheDocument();
  });
});

describe("PortfolioPage open orders", () => {
  it("describes each resting order with side, direction, price, and remaining size", () => {
    render(<PortfolioPage />);

    expect(screen.getByText("Open orders")).toBeInTheDocument();
    expect(screen.getByText("Sell at 62c")).toBeInTheDocument();
    expect(screen.getByText("75.00")).toBeInTheDocument();
    expect(screen.getByText("Jul 8, 2026, 12:00 AM UTC")).toBeInTheDocument();
    expect(screen.getByText("Manage on the market page")).toBeInTheDocument();
  });

  it("labels bids as buys", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        openOrders: [
          openOrderFixture({
            order: {
              ...openOrderFixture({}).order,
              direction: "bid",
            },
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<PortfolioPage />);

    expect(screen.getByText("Buy at 62c")).toBeInTheDocument();
  });
});

function portfolioFixture(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    chainId: 31337,
    openOrders: [openOrderFixture({})],
    owner: OWNER,
    positions: [positionFixture({})],
    receipts: [receiptFixture({})],
    summary: summaryFixture({}),
    ...overrides,
  };
}

function summaryFixture(
  overrides: Partial<Portfolio["summary"]>
): Portfolio["summary"] {
  return {
    claimableReceiptCount: 0,
    lockedCollateral: (150n * WAD).toString(),
    openOrderCount: 1,
    openReceiptCount: 2,
    positionCount: 1,
    totalPositionValueWad: (84n * WAD).toString(),
    ...overrides,
  };
}

function receiptFixture(overrides: Partial<PortfolioReceipt>): PortfolioReceipt {
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

function positionFixture(overrides: Partial<PortfolioPosition>): PortfolioPosition {
  return {
    avgCostWad: ((WAD * 55n) / 100n).toString(),
    committedInOrders: (100n * WAD).toString(),
    currentValueWad: (84n * WAD).toString(),
    graduationShares: (58n * WAD).toString(),
    heldBalance: (40n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    ownedTotal: (140n * WAD).toString(),
    poolId: `0x${"aa".repeat(32)}`,
    poolPriceWad: ((WAD * 60n) / 100n).toString(),
    side: "yes",
    ...overrides,
  };
}

function openOrderFixture(overrides: Partial<PortfolioOpenOrder>): PortfolioOpenOrder {
  return {
    marketId: "7",
    marketQuestion: "Will it pop?",
    order: {
      amountIn: (100n * WAD).toString(),
      createdBlockTimestamp: "2026-07-08T00:00:00.000Z",
      createdTransactionHash: `0x${"cc".repeat(32)}`,
      direction: "ask",
      orderId: 9,
      owner: OWNER,
      poolId: `0x${"aa".repeat(32)}`,
      priceWad: ((WAD * 62n) / 100n).toString(),
      remainingSizeWad: (75n * WAD).toString(),
      side: "yes",
      sizeWad: (100n * WAD).toString(),
      status: "open",
      tickLower: -6960,
      tickUpper: -6900,
    },
    ...overrides,
  };
}
