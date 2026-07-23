import type { MarketOrderBook, VenueOrderBookPool } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { OrderBookCard } from "./order-book-card";

const useOrderBookMock = vi.hoisted(() => vi.fn());

vi.mock("./use-order-book", () => ({
  useOrderBook: useOrderBookMock,
}));

beforeEach(() => {
  useOrderBookMock.mockReturnValue({ book: null, error: null, loading: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OrderBookCard", () => {
  it("renders nothing for a fixture-backed market and disables fetching", () => {
    const { container } = render(<OrderBookCard market={marketFactory()} />);

    expect(container).toBeEmptyDOMElement();
    expect(useOrderBookMock).toHaveBeenCalledWith(null);
  });

  it("renders nothing when the market id is not chain-prefixed", () => {
    const { container } = render(
      <OrderBookCard market={marketFactory({ chainId: 31337 })} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(useOrderBookMock).toHaveBeenCalledWith(null);
  });

  it("polls the parsed chain-prefixed lookup for an API-backed market", () => {
    render(<OrderBookCard market={apiMarket()} />);

    expect(useOrderBookMock).toHaveBeenCalledWith({
      chainId: 31337,
      marketId: "0xabc",
    });
  });

  it("shows the loading state before the first book arrives", () => {
    render(<OrderBookCard market={apiMarket()} />);

    expect(screen.getByText("Order book")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Resting maker orders on the bounded venue. Updates as orders and swaps land."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Loading order book…")).toBeInTheDocument();
  });

  it("reports a fetch failure when no book has loaded", () => {
    useOrderBookMock.mockReturnValue({
      book: null,
      error: "Order book request failed (502).",
      loading: false,
    });

    render(<OrderBookCard market={apiMarket()} />);

    expect(screen.getByText("Order book request failed (502).")).toBeInTheDocument();
  });

  it("explains a book whose venue pools are not indexed yet", () => {
    useOrderBookMock.mockReturnValue({
      book: bookFactory(),
      error: null,
      loading: false,
    });

    render(<OrderBookCard market={apiMarket()} />);

    expect(
      screen.getByText(
        "Venue pools are not indexed yet. The book appears once the postgrad handoff lands onchain."
      )
    ).toBeInTheDocument();
  });

  it("renders the selected outcome's ladder with creator outcome labels", () => {
    useOrderBookMock.mockReturnValue({
      book: bookFactory({ yes: poolFactory() }),
      error: null,
      loading: false,
    });

    render(
      <OrderBookCard market={apiMarket({ outcomeNo: "Under", outcomeYes: "Over" })} />
    );

    expect(screen.getByRole("button", { name: "Over" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("table", { name: "Over order book depth ladder" })
    ).toBeInTheDocument();
    expect(screen.getByText("66c")).toBeInTheDocument();
  });

  it("reports an unindexed pool when switching to an outcome without one", () => {
    useOrderBookMock.mockReturnValue({
      book: bookFactory({ yes: poolFactory() }),
      error: null,
      loading: false,
    });

    render(<OrderBookCard market={apiMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "NO" }));

    expect(screen.getByText("The NO pool is not indexed yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("switches between independent YES and NO pool ladders", () => {
    useOrderBookMock.mockReturnValue({
      book: bookFactory({
        no: poolFactory({
          asks: [
            {
              orderCount: 2,
              priceWad: "420000000000000000",
              sizeWad: "7000000000000000000",
              tickLower: -100,
              tickUpper: 0,
            },
          ],
          side: "no",
        }),
        yes: poolFactory(),
      }),
      error: null,
      loading: false,
    });

    render(<OrderBookCard market={apiMarket()} />);
    expect(screen.getByText("66c")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "NO" }));

    expect(
      screen.getByRole("table", { name: "NO order book depth ladder" })
    ).toBeInTheDocument();
    expect(screen.getByText("42c")).toBeInTheDocument();
    expect(screen.queryByText("66c")).not.toBeInTheDocument();
  });

  it("keeps the last book visible and flags interrupted live updates", () => {
    useOrderBookMock.mockReturnValue({
      book: bookFactory({ yes: poolFactory() }),
      error: "Order book request failed (500).",
      loading: false,
    });

    render(<OrderBookCard market={apiMarket()} />);

    expect(screen.getByText("66c")).toBeInTheDocument();
    expect(
      screen.getByText("Live updates interrupted — showing the last indexed book.")
    ).toBeInTheDocument();
  });
});

function apiMarket(overrides: Parameters<typeof marketFactory>[0] = {}) {
  return marketFactory({
    chainId: 31337,
    id: "31337:0xabc",
    status: "graduated",
    ...overrides,
  });
}

function bookFactory(overrides: Partial<MarketOrderBook> = {}): MarketOrderBook {
  return {
    chainId: 31337,
    marketId: "0xabc",
    ...overrides,
  };
}

function poolFactory(overrides: Partial<VenueOrderBookPool> = {}): VenueOrderBookPool {
  return {
    asks: [
      {
        orderCount: 1,
        priceWad: "660000000000000000",
        sizeWad: "10000000000000000000",
        tickLower: -100,
        tickUpper: 0,
      },
    ],
    bids: [],
    marketPriceWad: "640000000000000000",
    outcomeTokenAddress: "0x00000000000000000000000000000000000000d1",
    poolId: `0x${"1f".repeat(32)}`,
    side: "yes",
    ...overrides,
  };
}
