import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import type { VenueTradingEnvironment } from "./postgrad-swap-service";
import { PostgradTicket, PostgradTradePanel } from "./postgrad-ticket";
import { usePostgradTicketState } from "./use-postgrad-ticket-state";

vi.mock("./use-postgrad-ticket-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-postgrad-ticket-state")>()),
  usePostgradTicketState: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(usePostgradTicketState).mockReturnValue(ticketState());
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
      screen.getByText("Wallet-signed market order on the bounded venue.")
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
});

function ticketState(
  overrides: Partial<ReturnType<typeof usePostgradTicketState>> = {}
): ReturnType<typeof usePostgradTicketState> {
  return {
    action: "buy",
    amount: "250",
    amountFieldError: undefined,
    balances: { collateral: 1_000, error: null, loading: false, no: 0, yes: 0 },
    canMintTestPusd: true,
    completedSwap: null,
    environment: contractEnvironment(),
    isMinting: false,
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
    side: "yes",
    submitError: null,
    swapAction: { disabled: false, label: "Buy YES tokens", onClick: vi.fn() },
    swapStep: null,
    walletConnected: true,
    mintTestPusd: vi.fn(),
    selectAction: vi.fn(),
    selectPresetAmount: vi.fn(),
    selectSide: vi.fn(),
    updateAmount: vi.fn(),
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
      poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
      quoterAddress: null,
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
