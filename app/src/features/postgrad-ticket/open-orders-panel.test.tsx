import type { VenueOrder } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { OpenOrdersPanel } from "./open-orders-panel";
import {
  type OpenOrderRow,
  useOpenOrdersPanelState,
} from "./use-open-orders-panel-state";

vi.mock("./use-open-orders-panel-state", () => ({
  useOpenOrdersPanelState: vi.fn(),
}));

const cancelOrder = vi.fn();

beforeEach(() => {
  vi.mocked(useOpenOrdersPanelState).mockReturnValue(panelState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OpenOrdersPanel", () => {
  it("renders nothing when the panel is hidden", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(panelState({ visible: false }));

    const { container } = renderPanel();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty book while in market mode", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({ ordersLoaded: true, rows: [] })
    );

    const { container } = renderPanel({ orderType: "market" });

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading hint for an empty book still loading in limit mode", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({ loading: true, ordersLoaded: false, rows: [] })
    );

    renderPanel({ orderType: "limit" });

    expect(screen.getByText("Loading your open orders...")).toBeInTheDocument();
  });

  it("shows the empty-book hint once the read settles in limit mode", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({ ordersLoaded: true, rows: [] })
    );

    renderPanel({ orderType: "limit" });

    expect(
      screen.getByText(/No open orders yet\. Limit orders you place rest here/)
    ).toBeInTheDocument();
  });

  it("surfaces a read error", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({ error: "Could not load your open orders.", rows: [] })
    );

    renderPanel({ orderType: "limit" });

    expect(screen.getByText("Could not load your open orders.")).toBeInTheDocument();
  });

  it("renders a resting bid row and cancels it", () => {
    renderPanel();

    expect(screen.getByText("Buy")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("@ 30c")).toBeInTheDocument();
    expect(screen.getByText("100 / 100 tok open")).toBeInTheDocument();
    expect(screen.queryByText("Filling...")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel buy order at 30c" }));

    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(cancelOrder).toHaveBeenCalledWith(panelState().rows[0]);
  });

  it("renders a sell row with the filling badge and a disabled cancel button", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({
        rows: [
          row({
            cancelling: true,
            filling: true,
            order: openOrder({ direction: "ask", side: "no" }),
            priceCents: 72,
            remainingSize: 40,
            sideLabel: "NO",
            size: 100,
          }),
        ],
      })
    );

    renderPanel();

    expect(screen.getByText("Sell")).toBeInTheDocument();
    expect(screen.getByText("@ 72c")).toBeInTheDocument();
    expect(screen.getByText("40 / 100 tok open")).toBeInTheDocument();
    expect(screen.getByText("Filling...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel sell order at 72c" })
    ).toBeDisabled();
  });

  it("shows the in-flight cancel step and any cancel error", () => {
    vi.mocked(useOpenOrdersPanelState).mockReturnValue(
      panelState({
        cancelError: "This order has already been filled or cancelled.",
        cancelStep: "cancelling",
      })
    );

    renderPanel();

    expect(screen.getByText("Cancelling order...")).toBeInTheDocument();
    expect(
      screen.getByText("This order has already been filled or cancelled.")
    ).toBeInTheDocument();
  });
});

function renderPanel({ orderType = "limit" }: { orderType?: "limit" | "market" } = {}) {
  return render(
    <OpenOrdersPanel market={venueMarket()} orderType={orderType} refreshKey={0} />
  );
}

function panelState(
  overrides: Partial<ReturnType<typeof useOpenOrdersPanelState>> = {}
): ReturnType<typeof useOpenOrdersPanelState> {
  return {
    cancelError: null,
    cancelOrder,
    cancelStep: null,
    error: null,
    loading: false,
    ordersLoaded: true,
    rows: [row()],
    visible: true,
    ...overrides,
  };
}

function row(overrides: Partial<OpenOrderRow> = {}): OpenOrderRow {
  return {
    cancelling: false,
    filling: false,
    key: `${"0x" + "11".repeat(32)}:9`,
    order: openOrder(),
    priceCents: 30,
    remainingSize: 100,
    sideLabel: "YES",
    size: 100,
    ...overrides,
  };
}

function openOrder(overrides: Partial<VenueOrder> = {}): VenueOrder {
  return {
    amountIn: "30000000000000000000",
    createdBlockTimestamp: "2026-07-08T00:00:00.000Z",
    createdTransactionHash: `0x${"cc".repeat(32)}`,
    direction: "bid",
    orderId: 9,
    owner: "0x1111111111111111111111111111111111111111",
    poolId: `0x${"11".repeat(32)}`,
    priceWad: "300000000000000000",
    remainingSizeWad: "100000000000000000000",
    side: "yes",
    sizeWad: "100000000000000000000",
    status: "open",
    tickLower: -12120,
    tickUpper: -12060,
    ...overrides,
  };
}

function venueMarket(): Market {
  return marketFactory({ chainId: 31337, id: "31337:7", status: "graduated" });
}
