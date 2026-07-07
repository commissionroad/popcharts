import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { DiscoveryBoard } from "./discovery-board";

describe("DiscoveryBoard", () => {
  it("renders every market under the default filters", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    expect(screen.getByText("Crypto pumps?")).toBeInTheDocument();
    expect(screen.getByText("Politics shifts?")).toBeInTheDocument();
    expect(screen.getByText("Sports upset?")).toBeInTheDocument();
  });

  it("renders an empty grid when there are no markets", () => {
    render(<DiscoveryBoard markets={[]} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // The filter chrome still renders.
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("filters markets by the selected category", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Politics" }));

    expect(screen.getByText("Politics shifts?")).toBeInTheDocument();
    expect(screen.queryByText("Crypto pumps?")).not.toBeInTheDocument();
    expect(screen.queryByText("Sports upset?")).not.toBeInTheDocument();
  });

  it("returns to all categories when All is re-selected", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Politics" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText("Crypto pumps?")).toBeInTheDocument();
    expect(screen.getByText("Sports upset?")).toBeInTheDocument();
  });

  it("shows only graduating markets under the Graduating filter", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Graduating" }));

    expect(screen.getByText("Crypto pumps?")).toBeInTheDocument();
    expect(screen.queryByText("Politics shifts?")).not.toBeInTheDocument();
    expect(screen.queryByText("Sports upset?")).not.toBeInTheDocument();
  });

  it("combines the category and graduating filters", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Graduating" }));
    fireEvent.click(screen.getByRole("button", { name: "Politics" }));

    expect(screen.queryByText("Crypto pumps?")).not.toBeInTheDocument();
    expect(screen.queryByText("Politics shifts?")).not.toBeInTheDocument();
  });
});

function boardMarkets(): Market[] {
  return [
    marketFactory({
      category: "Crypto",
      id: "crypto-1",
      question: "Crypto pumps?",
      status: "graduating",
    }),
    marketFactory({
      category: "Politics",
      id: "politics-1",
      question: "Politics shifts?",
      status: "bootstrap",
    }),
    marketFactory({
      category: "Sports",
      id: "sports-1",
      question: "Sports upset?",
      status: "bootstrap",
    }),
  ];
}
