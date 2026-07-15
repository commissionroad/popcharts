import type { Portfolio, PortfolioPosition } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { configuredPopChartsChainId } from "@/integrations/contracts/config";
import { marketFactory } from "@/test/factories/markets";

import { ClaimWinningsPanel } from "./claim-winnings-panel";

const usePortfolio = vi.hoisted(() => vi.fn());
const useWalletAccount = vi.hoisted(() => vi.fn());
const useRedemption = vi.hoisted(() => vi.fn());

vi.mock("@/features/portfolio/use-portfolio", () => ({ usePortfolio }));

vi.mock("@/integrations/wallet/wallet-provider", () => ({ useWalletAccount }));

vi.mock("@/integrations/contracts/hooks/use-redemption", () => ({
  useRedemption,
}));

const OWNER = "0x1111111111111111111111111111111111111111";
const MARKET = "0x2222222222222222222222222222222222222222";
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
  useRedemption.mockReset();
  useRedemption.mockReturnValue({
    error: null,
    redeem: vi.fn(),
    redeemDraw: vi.fn(),
    result: null,
    status: "idle",
  });
});

describe("ClaimWinningsPanel visibility", () => {
  it.each([
    ["resolution", marketWithoutResolution()],
    ["postgrad address", marketWithoutAddress()],
    ["winning side", resolvedMarket({ resolution: resolutionWithoutWinningSide() })],
  ])("renders nothing without a market %s", (_reason, market) => {
    const { container } = render(<ClaimWinningsPanel market={market} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without a connected wallet", () => {
    useWalletAccount.mockReturnValue({ address: null });

    const { container } = render(<ClaimWinningsPanel market={resolvedMarket()} />);

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

    const { container } = render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an uninvolved wallet", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ positions: [] }),
      refresh: vi.fn(),
    });

    const { container } = render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the market id is not chain-prefixed", () => {
    const { container } = render(
      <ClaimWinningsPanel market={resolvedMarket({ id: "off-chain" })} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ClaimWinningsPanel redemption", () => {
  it("claims the winning held balance", () => {
    const redeem = vi.fn();
    useRedemption.mockReturnValue({
      error: null,
      redeem,
      redeemDraw: vi.fn(),
      result: null,
      status: "idle",
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    const { onRedeemed } = useRedemption.mock.calls[0]![0]!;
    const { refresh } = usePortfolio.mock.results.at(-1)!.value;
    expect(onRedeemed).toBe(refresh);
    fireEvent.click(screen.getByRole("button", { name: "Claim $40.00" }));
    expect(redeem).toHaveBeenCalledWith({
      amount: 40n * WAD,
      marketAddress: MARKET,
      side: "yes",
    });
  });

  it("uses the resolution market address when the handoff is absent", () => {
    const redeem = vi.fn();
    useRedemption.mockReturnValue({
      error: null,
      redeem,
      redeemDraw: vi.fn(),
      result: null,
      status: "idle",
    });

    render(<ClaimWinningsPanel market={marketWithoutPostgrad()} />);

    fireEvent.click(screen.getByRole("button", { name: "Claim $40.00" }));
    expect(redeem).toHaveBeenCalledWith({
      amount: 40n * WAD,
      marketAddress: MARKET,
      side: "yes",
    });
  });

  it("locks the claim button while pending", () => {
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "pending",
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(screen.getByRole("button", { name: "Claiming…" })).toBeDisabled();
  });

  it("shows the confirmed display value, not raw collateral or tokens burned", () => {
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      // Pin display value independently from both raw collateral precision and
      // the number of outcome tokens burned.
      result: {
        collateralAmount: 24n * 10n ** 6n,
        outcomeAmount: 24n * WAD,
        valueWad: 17n * WAD,
      },
      status: "success",
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(screen.getByText(/Claimed/)).toHaveTextContent(
      "Claimed $17.00 for 24.00 winning YES tokens."
    );
  });

  it("calls out winning tokens committed in open orders", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture({ committedInOrders: (12n * WAD).toString() })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(
      screen.getByText(/12.00 more winning YES tokens are resting in open orders/)
    ).toBeInTheDocument();
  });

  it("explains losing-side holdings alongside a winning claim", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture(), positionFixture({ side: "no" })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(
      screen.getByText(
        "Your NO tokens finished out of the money and cannot be redeemed."
      )
    ).toBeInTheDocument();
  });

  it("explains a wallet that holds only losing tokens", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture({ side: "no" })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(
      screen.getByText(
        "This market resolved YES. Your NO tokens finished out of the money."
      )
    ).toBeInTheDocument();
  });

  it("retains the panel after a claim while the position reindexes", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({ positions: [] }),
      refresh: vi.fn(),
    });
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "success",
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(screen.getByText("Claim winnings")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This market resolved YES. Nothing is left to claim on this position."
      )
    ).toBeInTheDocument();
  });

  it("explains when every winning token is resting in orders", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [
          positionFixture({
            committedInOrders: (40n * WAD).toString(),
            heldBalance: "0",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(
      screen.getByText(
        "All of your winning YES tokens are resting in open orders — cancel those orders to claim them."
      )
    ).toBeInTheDocument();
    // The "more tokens" footnote only accompanies the claim button; showing
    // both here would stack two contradictory versions of the same fact.
    expect(
      screen.queryByText(/more winning YES tokens are resting/)
    ).not.toBeInTheDocument();
  });

  it("treats sub-cent winning dust as nothing to claim instead of a $0.00 button", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        // Below the one-cent floor (1e16 WAD): redeemable can round to zero
        // on 6-decimal collateral, so no claim button may render.
        positions: [positionFixture({ heldBalance: (10n ** 11n).toString() })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This market resolved YES. Nothing is left to claim on this position."
      )
    ).toBeInTheDocument();
  });

  it("renders the redemption error", () => {
    useRedemption.mockReturnValue({
      error: "Could not claim your winnings.",
      redeem: vi.fn(),
      redeemDraw: vi.fn(),
      result: null,
      status: "error",
    });

    render(<ClaimWinningsPanel market={resolvedMarket()} />);

    expect(screen.getByText("Could not claim your winnings.")).toBeInTheDocument();
  });
});

describe("ClaimWinningsPanel draw redemption", () => {
  it("claims both outcome balances at half value", () => {
    const redeemDraw = vi.fn();
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [
          positionFixture(),
          positionFixture({ heldBalance: (20n * WAD).toString(), side: "no" }),
        ],
      }),
      refresh: vi.fn(),
    });
    useRedemption.mockReturnValue({
      error: null,
      redeem: vi.fn(),
      redeemDraw,
      result: null,
      status: "idle",
    });

    render(<ClaimWinningsPanel market={drawMarket()} />);

    expect(screen.getByText("Claim redemption")).toBeInTheDocument();
    expect(screen.getByText(/This market was cancelled — a draw/)).toHaveTextContent(
      "This market was cancelled — a draw. Your 60.00 outcome tokens each redeem at half value."
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim $30.00" }));
    expect(redeemDraw).toHaveBeenCalledWith({
      marketAddress: MARKET,
      noAmount: 20n * WAD,
      yesAmount: 40n * WAD,
    });
  });

  it("treats a sub-cent half value as nothing left to claim", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture({ heldBalance: (10n ** 16n).toString() })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={drawMarket()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "This market was cancelled — a draw. Nothing is left to claim on this position."
      )
    ).toBeInTheDocument();
  });

  it("uses outcome-token wording when every draw token is in orders", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [
          positionFixture({
            committedInOrders: (40n * WAD).toString(),
            heldBalance: "0",
          }),
        ],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={drawMarket()} />);

    expect(
      screen.getByText(
        "All of your outcome tokens are resting in open orders — cancel those orders to claim them."
      )
    ).toBeInTheDocument();
  });

  it("uses outcome-token wording for additional draw tokens in orders", () => {
    usePortfolio.mockReturnValue({
      error: null,
      loading: false,
      portfolio: portfolioFixture({
        positions: [positionFixture({ committedInOrders: (12n * WAD).toString() })],
      }),
      refresh: vi.fn(),
    });

    render(<ClaimWinningsPanel market={drawMarket()} />);

    expect(
      screen.getByText(/12.00 more outcome tokens are resting in open orders/)
    ).toBeInTheDocument();
  });
});

function resolvedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    id: `${configuredPopChartsChainId}:7`,
    postgrad: {
      adapterAddress: "0x00000000000000000000000000000000000000ab",
      completeSets: 40,
      finalizedAt: "2026-07-13T00:00:00.000Z",
      marketAddress: MARKET,
      refundedUsd: 0,
      retainedUsd: 40,
    },
    resolution: resolutionFixture(),
    status: "resolved",
    ...overrides,
  });
}

function drawMarket(overrides: Partial<Market> = {}): Market {
  return resolvedMarket({
    resolution: {
      kind: "cancelled",
      postgradMarket: MARKET,
      resolvedAt: "2026-07-14T00:00:00.000Z",
    },
    status: "cancelled",
    ...overrides,
  });
}

function resolutionFixture(
  overrides: Partial<NonNullable<Market["resolution"]>> = {}
): NonNullable<Market["resolution"]> {
  return {
    kind: "resolved",
    postgradMarket: MARKET,
    resolvedAt: "2026-07-14T00:00:00.000Z",
    winningSide: "yes",
    ...overrides,
  };
}

function resolutionWithoutWinningSide() {
  const resolution = resolutionFixture();
  delete resolution.winningSide;

  return resolution;
}

function marketWithoutResolution() {
  const market = resolvedMarket();
  delete market.resolution;

  return market;
}

function marketWithoutPostgrad() {
  const market = resolvedMarket();
  delete market.postgrad;

  return market;
}

function marketWithoutAddress() {
  const market = marketWithoutPostgrad();
  delete (market.resolution as Partial<NonNullable<Market["resolution"]>>)
    .postgradMarket;

  return market;
}

function portfolioFixture(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    chainId: configuredPopChartsChainId,
    openOrders: [],
    owner: OWNER,
    positions: [positionFixture()],
    receipts: [],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: "0",
      openOrderCount: 0,
      openReceiptCount: 0,
      positionCount: 1,
      totalPositionValueWad: (40n * WAD).toString(),
    },
    ...overrides,
  };
}

function positionFixture(
  overrides: Partial<PortfolioPosition> = {}
): PortfolioPosition {
  return {
    committedInOrders: "0",
    heldBalance: (40n * WAD).toString(),
    marketId: "7",
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    ownedTotal: (40n * WAD).toString(),
    side: "yes",
    ...overrides,
  };
}
