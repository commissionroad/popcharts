import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { MarketSearchResults } from "./market-search-results";

function results(props: Partial<Parameters<typeof MarketSearchResults>[0]> = {}) {
  const onClearFilters = vi.fn();
  const onRetry = vi.fn();

  const view = render(
    <MarketSearchResults
      filtered={false}
      markets={[]}
      onClearFilters={onClearFilters}
      onRetry={onRetry}
      query=""
      {...props}
    />
  );

  return { ...view, onClearFilters, onRetry };
}

function twoMarkets(): Market[] {
  return [
    marketFactory({ id: "one", question: "Will ETH flip $5,000?" }),
    marketFactory({ id: "two", question: "Will the Fed cut rates?" }),
  ];
}

describe("MarketSearchResults", () => {
  it("renders a card per market", () => {
    results({ markets: twoMarkets() });

    expect(screen.getByText("Will ETH flip $5,000?")).toBeInTheDocument();
    expect(screen.getByText("Will the Fed cut rates?")).toBeInTheDocument();
  });

  it("holds the grid's dimensions while the search is in flight", () => {
    const { container } = results({ markets: twoMarkets(), state: "loading" });

    expect(screen.getByRole("status", { name: "Searching markets" })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6);
    expect(screen.queryByText("Will ETH flip $5,000?")).not.toBeInTheDocument();
  });

  it("distinguishes a failed search from an empty one, and can retry", () => {
    const { onRetry } = results({ filtered: true, query: "fed", state: "error" });

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load markets");
    expect(screen.queryByText(/No markets match/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("quotes the query back and offers the create flow when nothing matches", () => {
    const { onClearFilters } = results({ filtered: true, query: " eurovision " });

    expect(screen.getByText("No markets match “eurovision”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create this market" })).toHaveAttribute(
      "href",
      "/create"
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("drops the create prompt when filters, not a query, emptied the board", () => {
    results({ filtered: true, query: "" });

    expect(screen.getByText("No markets match these filters")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create this market" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("keeps the board's own empty copy when nothing is filtered", () => {
    results();

    expect(screen.getByRole("status")).toHaveTextContent(
      "No markets match this view yet."
    );
    expect(
      screen.queryByRole("button", { name: "Clear filters" })
    ).not.toBeInTheDocument();
  });
});
