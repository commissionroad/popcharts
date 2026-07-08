import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrderBookLadder } from "./order-book-ladder";
import type { OrderBookLevelView, OrderBookPoolView } from "./order-book-model";

describe("OrderBookLadder", () => {
  it("renders asks above the spread row and bids below, best levels adjacent", () => {
    render(<OrderBookLadder pool={poolView()} sideLabel="YES" />);

    const table = screen.getByRole("table", {
      name: "YES order book depth ladder",
    });
    const rows = within(table).getAllByRole("row");
    // Header, worst ask, best ask, spread, best bid, worst bid.
    expect(rows).toHaveLength(6);
    expect(rows[1]).toHaveTextContent("70c");
    expect(rows[2]).toHaveTextContent("66c");
    expect(rows[3]).toHaveTextContent("Spread 4c · Pool price 64c");
    expect(rows[4]).toHaveTextContent("62c");
    expect(rows[5]).toHaveTextContent("60c");
  });

  it("shows size, cumulative depth, and order count per level", () => {
    render(<OrderBookLadder pool={poolView()} sideLabel="YES" />);

    const bestAskRow = screen.getByText("66c").closest("tr");
    expect(bestAskRow).toHaveTextContent("10");
    expect(within(bestAskRow as HTMLElement).getAllByRole("cell")[3]).toHaveTextContent(
      "3"
    );
  });

  it("scales each row's depth bar by its cumulative share of the book", () => {
    render(<OrderBookLadder pool={poolView()} sideLabel="YES" />);

    const worstBidRow = screen.getByText("60c").closest("tr");
    expect(worstBidRow).toHaveStyle({
      background: "linear-gradient(to left, var(--yes-wash) 100.0%, transparent 0)",
    });
    const bestAskRow = screen.getByText("66c").closest("tr");
    expect(bestAskRow?.style.background).toContain("var(--no-wash) 22.2%");
  });

  it("renders the whole-book empty state", () => {
    render(
      <OrderBookLadder
        pool={poolView({ asks: [], bids: [], spreadCents: null })}
        sideLabel="YES"
      />
    );

    expect(screen.getByText("No resting orders yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a per-half empty row when only one side rests orders", () => {
    render(
      <OrderBookLadder
        pool={poolView({ asks: [], maxCumulativeShares: 45, spreadCents: null })}
        sideLabel="YES"
      />
    );

    expect(screen.getByText("No resting asks yet.")).toBeInTheDocument();
    expect(screen.getByText("62c")).toBeInTheDocument();

    render(
      <OrderBookLadder
        pool={poolView({ bids: [], maxCumulativeShares: 35, spreadCents: null })}
        sideLabel="NO"
      />
    );

    expect(screen.getByText("No resting bids yet.")).toBeInTheDocument();
  });

  it("reports a pending pool price when neither spread nor price exists", () => {
    render(
      <OrderBookLadder
        pool={poolView({ bids: [], marketPriceCents: null, spreadCents: null })}
        sideLabel="YES"
      />
    );

    expect(screen.getByText("Pool price pending")).toBeInTheDocument();
  });

  it("shows the spread alone when the pool price is missing", () => {
    render(
      <OrderBookLadder pool={poolView({ marketPriceCents: null })} sideLabel="YES" />
    );

    expect(screen.getByText("Spread 4c")).toBeInTheDocument();
  });

  it("hides depth bars when the book has no cumulative depth to scale by", () => {
    render(
      <OrderBookLadder
        pool={poolView({
          asks: [level({ cumulativeShares: 0, priceCents: 66, sizeShares: 0 })],
          bids: [],
          maxCumulativeShares: 0,
          spreadCents: null,
        })}
        sideLabel="YES"
      />
    );

    const row = screen.getByText("66c").closest("tr");
    expect(row?.style.background).toContain("transparent");
  });
});

function level(overrides: Partial<OrderBookLevelView> = {}): OrderBookLevelView {
  return {
    cumulativeShares: 10,
    orderCount: 1,
    priceCents: 66,
    sizeShares: 10,
    ...overrides,
  };
}

function poolView(overrides: Partial<OrderBookPoolView> = {}): OrderBookPoolView {
  return {
    asks: [
      level({ cumulativeShares: 10, orderCount: 3, priceCents: 66, sizeShares: 10 }),
      level({ cumulativeShares: 35, priceCents: 70, sizeShares: 25 }),
    ],
    bids: [
      level({ cumulativeShares: 5, priceCents: 62, sizeShares: 5 }),
      level({ cumulativeShares: 45, priceCents: 60, sizeShares: 40 }),
    ],
    marketPriceCents: 64,
    maxCumulativeShares: 45,
    spreadCents: 4,
    ...overrides,
  };
}
