import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import type { VenueTradingEnvironment } from "./postgrad-swap-service";
import { PostgradTicket, PostgradTradePanel } from "./postgrad-ticket";
import { useLimitOrderState } from "./use-limit-order-state";
import { useOpenOrdersPanelState } from "./use-open-orders-panel-state";
import { usePostgradTicketState } from "./use-postgrad-ticket-state";

vi.mock("./use-postgrad-ticket-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-postgrad-ticket-state")>()),
  usePostgradTicketState: vi.fn(),
}));

vi.mock("./use-limit-order-state", () => ({
  useLimitOrderState: vi.fn(),
}));

vi.mock("./use-open-orders-panel-state", () => ({
  useOpenOrdersPanelState: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(usePostgradTicketState).mockReturnValue(ticketState());
  vi.mocked(useLimitOrderState).mockReturnValue(limitState());
  vi.mocked(useOpenOrdersPanelState).mockReturnValue(panelState());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PostgradTradePanel", () => {
  it("renders the trade ticket once the venue is live", () => {
    render(<PostgradTradePanel market={venueMarket()} />);

    expect(screen.getByText("Trade outcome tokens")).toBeInTheDocument();
  });

  it("reports wiring in progress for a handoff without a live venue", () => {
    const market = venueMarket();
    market.postgrad!.venue!.live = false;

    render(<PostgradTradePanel market={market} />);

    expect(screen.getByText("Post-graduation trading")).toBeInTheDocument();
    expect(screen.getByText("Venue wiring in progress")).toBeInTheDocument();
    expect(screen.getByText(/the bounded venue is not live yet/i)).toBeInTheDocument();
  });

  it("reports a pending handoff before postgrad indexes", () => {
    render(<PostgradTradePanel market={marketFactory({ status: "graduated" })} />);

    expect(screen.getByText("Handoff pending")).toBeInTheDocument();
    expect(
      screen.getByText(/onchain handoff has not been indexed yet/i)
    ).toBeInTheDocument();
  });
});

describe("PostgradTicket", () => {
  it("renders the devchain ticket with quote, balances, and action", () => {
    render(<PostgradTicket market={venueMarket()} />);

    expect(
      screen.getByText("Wallet-signed order on the bounded venue.")
    ).toBeInTheDocument();
    expect(screen.getByText("Devchain")).toBeInTheDocument();
    expect(screen.getByText("Wallet balances")).toBeInTheDocument();
    expect(screen.getByLabelText(/Collateral to spend/)).toHaveValue("250");
    expect(screen.getByRole("button", { name: "Buy YES tokens" })).toBeEnabled();
    expect(screen.getByText(/Market orders settle immediately/)).toBeInTheDocument();
  });

  it("labels the mock environment as a fixture preview", () => {
    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({ environment: { kind: "mock" } })
    );

    render(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByText("Fixture-backed venue preview.")).toBeInTheDocument();
    expect(screen.getByText("Mock")).toBeInTheDocument();
    expect(screen.queryByText("Wallet balances")).not.toBeInTheDocument();
  });

  it("drives side, action, amount, and preset changes through the hook", () => {
    const state = ticketState();
    vi.mocked(usePostgradTicketState).mockReturnValue(state);

    render(<PostgradTicket market={venueMarket()} />);

    fireEvent.click(screen.getByRole("button", { name: "NO" }));
    expect(state.selectSide).toHaveBeenCalledWith("no");

    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(state.selectAction).toHaveBeenCalledWith("sell");

    fireEvent.change(screen.getByLabelText(/Collateral to spend/), {
      target: { value: "99" },
    });
    expect(state.updateAmount).toHaveBeenCalledWith("99");

    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(state.selectPresetAmount).toHaveBeenCalledWith("Max");
  });

  it("relabels the amount field for sells on either side", () => {
    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({ action: "sell", side: "no" })
    );

    const { rerender } = render(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByLabelText(/Tokens to sell/)).toBeInTheDocument();
    expect(screen.getByText("NO tok")).toBeInTheDocument();

    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({ action: "sell", side: "yes" })
    );
    rerender(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByText("YES tok")).toBeInTheDocument();
  });

  it("shows the submit error and the swap step while placing", () => {
    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({
        isSwapping: true,
        submitError: "router unhappy",
        swapStep: "approving",
      })
    );

    render(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByText("router unhappy")).toBeInTheDocument();
    expect(screen.getByText("Approving router spend...")).toBeInTheDocument();
  });

  it("shows the price-bound quote warning without blocking the action", () => {
    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({ quoteWarning: "Price bound reached: too big for the band." })
    );

    render(<PostgradTicket market={venueMarket()} />);

    expect(
      screen.getByText("Price bound reached: too big for the band.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy YES tokens" })).toBeEnabled();
  });

  it("shows the completed swap notice", () => {
    vi.mocked(usePostgradTicketState).mockReturnValue(
      ticketState({
        completedSwap: {
          action: "buy",
          amountIn: 250n * 10n ** 18n,
          amountOut: 500n * 10n ** 18n,
          partialFill: false,
          requestedIn: 250n * 10n ** 18n,
          side: "yes",
          transactionHash: `0x${"bb".repeat(32)}`,
        },
      })
    );

    render(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByText("Order filled")).toBeInTheDocument();
  });

  it("uses the creator outcome labels on the side selector", () => {
    render(
      <PostgradTicket
        market={venueMarket({ outcomeNo: "UNDER", outcomeYes: "OVER" })}
      />
    );

    expect(screen.getByRole("button", { name: "OVER" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UNDER" })).toBeInTheDocument();
  });

  it("switches to the limit ticket and back through the order-type toggle", () => {
    render(<PostgradTicket market={venueMarket()} />);

    expect(screen.getByLabelText(/Collateral to spend/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limit" }));

    expect(screen.getByLabelText(/Limit price/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tokens to buy/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Collateral to spend/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Market" }));

    expect(screen.getByLabelText(/Collateral to spend/)).toBeInTheDocument();
  });
});

describe("PostgradTicket limit mode", () => {
  function renderLimitTicket(market: Market = venueMarket()) {
    render(<PostgradTicket market={market} />);
    fireEvent.click(screen.getByRole("button", { name: "Limit" }));
  }

  it("drives price, size, side, and action changes through the limit hook", () => {
    const state = limitState();
    vi.mocked(useLimitOrderState).mockReturnValue(state);

    renderLimitTicket();

    fireEvent.change(screen.getByLabelText(/Limit price/), {
      target: { value: "35" },
    });
    expect(state.updatePrice).toHaveBeenCalledWith("35");

    fireEvent.change(screen.getByLabelText(/Tokens to buy/), {
      target: { value: "200" },
    });
    expect(state.updateSize).toHaveBeenCalledWith("200");

    fireEvent.click(screen.getByRole("button", { name: "NO" }));
    expect(state.selectSide).toHaveBeenCalledWith("no");

    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(state.selectAction).toHaveBeenCalledWith("sell");
  });

  it("renders the preview, resting copy, and the place action", () => {
    renderLimitTicket();

    expect(screen.getByText("30.0c")).toBeInTheDocument();
    expect(screen.getByText("You deposit")).toBeInTheDocument();
    expect(screen.getByText("30 pUSD")).toBeInTheDocument();
    expect(screen.getByText("If filled you receive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place limit order" })).toBeEnabled();
    expect(screen.getByText(/rest on the venue's book/i)).toBeInTheDocument();
  });

  it("relabels the size field for sells", () => {
    vi.mocked(useLimitOrderState).mockReturnValue(limitState({ action: "sell" }));

    renderLimitTicket();

    expect(screen.getByLabelText(/Tokens to sell/)).toBeInTheDocument();
  });

  it("renders the NO side with its outcome label on the size field", () => {
    vi.mocked(useLimitOrderState).mockReturnValue(limitState({ side: "no" }));

    renderLimitTicket();

    // The size field's unit suffix reflects the NO outcome label, exercising
    // the side="no" branch of the limit ticket's colors and labels.
    expect(screen.getByText(/NO tok/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Place limit order" })
    ).toBeInTheDocument();
  });

  it("shows the order step and submit error while placing", () => {
    vi.mocked(useLimitOrderState).mockReturnValue(
      limitState({
        isPlacing: true,
        orderStep: "placing",
        submitError: "order manager unhappy",
      })
    );

    renderLimitTicket();

    expect(screen.getByText("order manager unhappy")).toBeInTheDocument();
    expect(screen.getByText("Submitting limit order...")).toBeInTheDocument();
  });

  it("shows the resting-order confirmation", () => {
    vi.mocked(useLimitOrderState).mockReturnValue(
      limitState({
        completedOrder: {
          amountIn: 30n * 10n ** 18n,
          direction: "bid",
          orderId: 7,
          priceCents: 30,
          side: "yes",
          sizeWad: 100n * 10n ** 18n,
          transactionHash: `0x${"cc".repeat(32)}`,
        },
      })
    );

    renderLimitTicket();

    expect(screen.getByText("Limit order placed")).toBeInTheDocument();
    expect(screen.getByText("Buy 100 YES tokens at 30.0c")).toBeInTheDocument();
    expect(screen.getByText(/order #7/)).toBeInTheDocument();
  });

  it("bumps the open-orders refresh when an order is placed", () => {
    renderLimitTicket();

    const options = vi.mocked(useLimitOrderState).mock.calls.at(-1)?.[1];

    act(() => {
      options?.onOrderPlaced?.();
    });

    // The panel-state hook re-renders with the bumped refresh key.
    const lastPanelCall = vi.mocked(useOpenOrdersPanelState).mock.calls.at(-1);
    expect(lastPanelCall?.[1]).toEqual({ refreshKey: 1 });
  });
});

function ticketState(
  overrides: Partial<ReturnType<typeof usePostgradTicketState>> = {}
): ReturnType<typeof usePostgradTicketState> {
  return {
    action: "buy",
    amount: "250",
    amountFieldError: undefined,
    balances: { collateral: 1_000, error: null, loading: false, no: 0, yes: 0 },
    completedSwap: null,
    environment: contractEnvironment(),
    isSwapping: false,
    quote: {
      action: "buy",
      amountIn: 250n * 10n ** 18n,
      amountOut: 500n * 10n ** 18n,
      effectivePriceCents: 50,
      poolPriceCents: 48,
      side: "yes",
      source: "quoter",
    },
    quoteLoading: false,
    quoteWarning: null,
    side: "yes",
    submitError: null,
    swapAction: { disabled: false, label: "Buy YES tokens", onClick: vi.fn() },
    swapStep: null,
    walletConnected: true,
    selectAction: vi.fn(),
    selectPresetAmount: vi.fn(),
    selectSide: vi.fn(),
    updateAmount: vi.fn(),
    ...overrides,
  };
}

function limitState(
  overrides: Partial<ReturnType<typeof useLimitOrderState>> = {}
): ReturnType<typeof useLimitOrderState> {
  return {
    action: "buy",
    balances: { collateral: 1_000, error: null, loading: false, no: 0, yes: 0 },
    completedOrder: null,
    environment: contractEnvironment(),
    isPlacing: false,
    orderStep: null,
    placeAction: { disabled: false, label: "Place limit order", onClick: vi.fn() },
    priceFieldError: undefined,
    priceInput: "30",
    quote: {
      depositWad: 30n * 10n ** 18n,
      direction: "bid",
      priceCents: 30,
      sizeWad: 100n * 10n ** 18n,
    },
    side: "yes",
    sizeFieldError: undefined,
    sizeInput: "100",
    submitError: null,
    walletConnected: true,
    selectAction: vi.fn(),
    selectSide: vi.fn(),
    updatePrice: vi.fn(),
    updateSize: vi.fn(),
    ...overrides,
  };
}

function panelState(
  overrides: Partial<ReturnType<typeof useOpenOrdersPanelState>> = {}
): ReturnType<typeof useOpenOrdersPanelState> {
  return {
    cancelError: null,
    cancelStep: null,
    error: null,
    loading: false,
    ordersLoaded: true,
    rows: [],
    visible: false,
    cancelOrder: vi.fn(),
    ...overrides,
  };
}

function contractEnvironment(): VenueTradingEnvironment {
  return {
    config: {
      chainEnv: "local",
      chainId: 31337,
      collateralAddress: "0x0000000000000000000000000000000000000002",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      pregradManagerAddress: "0x0000000000000000000000000000000000000001",
      rpcUrl: "http://127.0.0.1:8545",
    },
    kind: "contract",
    venue: venueMarket().postgrad!.venue!,
    venueConfig: {
      orderManagerAddress: "0x00000000000000000000000000000000000000f2",
      poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
      quoterAddress: null,
      stateViewAddress: null,
      swapRouterAddress: "0x00000000000000000000000000000000000000b1",
    },
  };
}

function venueMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    chainId: 31337,
    id: "31337:7",
    postgrad: {
      adapterAddress: "0x00000000000000000000000000000000000000ab",
      completeSets: 100,
      finalizedAt: "2026-07-01T00:00:00.000Z",
      marketAddress: "0x00000000000000000000000000000000000000cd",
      refundedUsd: 0,
      retainedUsd: 100,
      venue: {
        boundedHookAddress: "0x00000000000000000000000000000000000000f1",
        live: true,
        noPool: {
          displayPriceWad: "120000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x0000000000000000000000000000000000000004",
          poolId: `0x${"22".repeat(32)}`,
          whitelisted: true,
        },
        orderManagerAddress: "0x00000000000000000000000000000000000000f2",
        poolManagerAddress: "0x00000000000000000000000000000000000000f0",
        yesPool: {
          displayPriceWad: "880000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x0000000000000000000000000000000000000003",
          poolId: `0x${"11".repeat(32)}`,
          whitelisted: true,
        },
      },
    },
    status: "graduated",
    ...overrides,
  });
}
