import type {
  Portfolio,
  PortfolioPosition,
  PortfolioReceipt,
} from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { marketFactory } from "@/test/factories/markets";

import { MarketPositionPanel } from "./market-position-panel";

const usePortfolio = vi.hoisted(() => vi.fn());
const useWalletAccount = vi.hoisted(() => vi.fn());
const useRefundClaim = vi.hoisted(() => vi.fn());

vi.mock("@/features/portfolio/use-portfolio", () => ({ usePortfolio }));

vi.mock("@/integrations/wallet/wallet-provider", () => ({ useWalletAccount }));

vi.mock("@/integrations/contracts/hooks/use-refund-claim", () => ({
  useRefundClaim,
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
  useRefundClaim.mockReset();
  useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "idle" });
});

/** A graduated market whose raw indexer id ("7") matches the fixtures below. */
function graduatedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    id: `${configuredPopChartsChainId}:7`,
    outcomeNo: "NO",
    outcomeYes: "YES",
    status: "graduated",
    ...overrides,
  });
}

function bootstrapMarket(overrides: Partial<Market> = {}): Market {
  return graduatedMarket({ status: "bootstrap", ...overrides });
}

describe("MarketPositionPanel visibility", () => {
  it("renders nothing without a connected wallet", () => {
    useWalletAccount.mockReturnValue({ address: null });

    const { container } = render(<MarketPositionPanel market={graduatedMarket()} />);

    expect(container).toBeEmptyDOMElement();
    // The hook still runs, disabled, with a null owner.
    expect(usePortfolio).toHaveBeenCalledWith({
      chainId: configuredPopChartsChainId,
      owner: null,
    });
  });

  it("renders nothing while the first portfolio read is in flight", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: true,
      portfolio: null,
      refresh: vi.fn(),
    });

    const { container } = render(<MarketPositionPanel market={graduatedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the market id is not chain-prefixed", () => {
    const { container } = render(
      <MarketPositionPanel market={graduatedMarket({ id: "eth-5000-august" })} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the wallet holds no stake in this market", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture({ marketId: "999" })],
        receipts: [receiptFixture({ marketId: "999" })],
      }),
      refresh: vi.fn(),
    });

    const { container } = render(<MarketPositionPanel market={graduatedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("MarketPositionPanel graduated positions", () => {
  it("summarizes held tokens, entry vs current price, orders, and total value", () => {
    render(<MarketPositionPanel market={graduatedMarket()} />);

    expect(screen.getByText("Your position")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    // Row value and headline total both read the same figure.
    expect(screen.getAllByText("$84.00")).toHaveLength(2);
    expect(screen.getByText("140 tok")).toBeInTheDocument();
    expect(screen.getByText("· avg 55c")).toBeInTheDocument();
    expect(screen.getByText("· now 60c")).toBeInTheDocument();
    expect(screen.getByText("40.00 held · 100 in orders")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View full portfolio/ })).toHaveAttribute(
      "href",
      "/portfolio"
    );
  });

  it("dashes the value and hides prices, total, and orders when unpriced", () => {
    const position = positionFixture({ side: "no" });
    delete position.avgCostWad;
    delete position.currentValueWad;
    delete position.poolPriceWad;
    position.committedInOrders = "0";
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ positions: [position] }),
      refresh: vi.fn(),
    });

    render(<MarketPositionPanel market={graduatedMarket()} />);

    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/avg/)).not.toBeInTheDocument();
    expect(screen.queryByText(/now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in orders/)).not.toBeInTheDocument();
    // No priced position means no headline total.
    expect(screen.queryByText(/^\$/)).not.toBeInTheDocument();
  });

  it("shows positions instead of receipts once the market resolves", () => {
    render(<MarketPositionPanel market={graduatedMarket({ status: "resolved" })} />);

    expect(screen.getByText("Your position")).toBeInTheDocument();
    expect(screen.getByText("140 tok")).toBeInTheDocument();
    expect(screen.queryByText("Your receipts")).not.toBeInTheDocument();
  });

  it("shows positions for a postgrad cancelled draw", () => {
    render(
      <MarketPositionPanel
        market={graduatedMarket({
          resolution: {
            kind: "cancelled",
            postgradMarket: "0x2222222222222222222222222222222222222222",
            resolvedAt: "2026-07-14T00:00:00.000Z",
          },
          status: "cancelled",
        })}
      />
    );

    expect(screen.getByText("Your position")).toBeInTheDocument();
    expect(screen.getByText("140 tok")).toBeInTheDocument();
    expect(screen.queryByText("Your receipts")).not.toBeInTheDocument();
  });
});

describe("MarketPositionPanel pre-graduation receipts", () => {
  it("shows receipts for a pregrad cancellation without a resolution", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ positions: [] }),
      refresh: vi.fn(),
    });

    render(<MarketPositionPanel market={bootstrapMarket({ status: "cancelled" })} />);

    expect(screen.getByText("Your receipts")).toBeInTheDocument();
    expect(screen.getByText("100 tok")).toBeInTheDocument();
    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
  });

  it("lists this market's receipts with cost, average, and lifecycle status", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [],
        receipts: [
          receiptFixture({ receiptId: "11", status: "awaiting_graduation" }),
          receiptFixture({
            receiptId: "12",
            shares: "0",
            side: "no",
            status: "claimable",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<MarketPositionPanel market={bootstrapMarket()} />);

    expect(screen.getByText("Your receipts")).toBeInTheDocument();
    expect(screen.queryByText("Your position")).not.toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getAllByText("$60.00")).toHaveLength(2);
    // 60 cost / 100 shares = 60c average; the zero-share receipt omits it.
    expect(screen.getByText("· 60c avg")).toBeInTheDocument();
    // The shared settlement renderer replaces the bare status label.
    expect(screen.getByText("Waiting for graduation")).toBeInTheDocument();
    expect(screen.getByText("Graduated")).toBeInTheDocument();
    expect(screen.getByText("Ready to claim on the market page")).toBeInTheDocument();
  });

  it("shows the settlement result for settled, refunded, and cancelled receipts", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [],
        receipts: [
          receiptFixture({
            receiptId: "21",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (25n * WAD).toString(),
              retainedCost: (35n * WAD).toString(),
              retainedShares: (58n * WAD).toString(),
            },
            status: "settled",
          }),
          receiptFixture({
            receiptId: "22",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (60n * WAD).toString(),
            },
            side: "no",
            status: "refunded",
          }),
          receiptFixture({ receiptId: "23", status: "refund_claimable" }),
        ],
      }),
      refresh: vi.fn(),
    });

    // A cancelled market still surfaces its receipts (it is not "graduated").
    render(<MarketPositionPanel market={bootstrapMarket({ status: "cancelled" })} />);

    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByText("58.00 YES tokens + $25.00 refunded")).toBeInTheDocument();
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("$60.00 returned")).toBeInTheDocument();
    // The refund-claimable receipt shows the amount plus a working Claim
    // button, not the portfolio's "claim on the market page" pointer.
    expect(screen.getByText("$60.00 refund available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim refund" })).toBeInTheDocument();
    expect(screen.queryByText("Claim on the market page")).not.toBeInTheDocument();
  });
});

describe("MarketPositionPanel refund claim", () => {
  function renderRefundClaimable() {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [],
        receipts: [
          receiptFixture({
            cost: (24n * WAD).toString(),
            receiptId: "32",
            status: "refund_claimable",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<MarketPositionPanel market={bootstrapMarket({ status: "cancelled" })} />);
  }

  it("claims the receipt's refund with the connected wallet on click", () => {
    const claim = vi.fn();
    useRefundClaim.mockReturnValue({ claim, error: null, status: "idle" });
    renderRefundClaimable();

    // The panel wires the portfolio refresh into the claim hook so a confirmed
    // claim flips the row to `refunded` once the indexer catches up.
    const { onClaimed } = useRefundClaim.mock.calls[0]![0]!;
    const { refresh } = usePortfolio.mock.results.at(-1)!.value;
    expect(onClaimed).toBe(refresh);

    fireEvent.click(screen.getByRole("button", { name: "Claim refund" }));
    expect(claim).toHaveBeenCalledWith("32");
  });

  it("locks the button and shows progress while a claim is pending", () => {
    useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "pending" });
    renderRefundClaimable();

    expect(screen.getByRole("button", { name: "Claiming refund…" })).toBeDisabled();
  });

  it("locks the button after a confirmed claim until the row reindexes", () => {
    useRefundClaim.mockReturnValue({ claim: vi.fn(), error: null, status: "success" });
    renderRefundClaimable();

    expect(screen.getByRole("button", { name: "Refund claimed" })).toBeDisabled();
  });

  it("surfaces a claim error beneath an actionable button", () => {
    useRefundClaim.mockReturnValue({
      claim: vi.fn(),
      error: "Could not claim your refund.",
      status: "error",
    });
    renderRefundClaimable();

    expect(screen.getByRole("button", { name: "Claim refund" })).toBeEnabled();
    expect(screen.getByText("Could not claim your refund.")).toBeInTheDocument();
  });
});

function portfolioFixture(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    chainId: configuredPopChartsChainId,
    openOrders: [],
    owner: OWNER,
    positions: [positionFixture()],
    receipts: [receiptFixture()],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: "0",
      openOrderCount: 0,
      openReceiptCount: 1,
      positionCount: 1,
      totalPositionValueWad: (84n * WAD).toString(),
    },
    ...overrides,
  };
}

function positionFixture(
  overrides: Partial<PortfolioPosition> = {}
): PortfolioPosition {
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
