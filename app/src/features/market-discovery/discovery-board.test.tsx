import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { DiscoveryBoard } from "./discovery-board";

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

// "All" appears twice: once in the category row, once as the status chip.
// The category row renders first, so index 0 is the category and index 1 the
// status view.
function allButtons() {
  return screen.getAllByRole("button", { name: "All" });
}

describe("DiscoveryBoard", () => {
  it("renders every market under the default filters", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    expect(screen.getByText("Crypto pumps?")).toBeInTheDocument();
    expect(screen.getByText("Politics shifts?")).toBeInTheDocument();
    expect(screen.getByText("Sports upset?")).toBeInTheDocument();
  });

  it("shows the empty state when there are no markets", () => {
    render(<DiscoveryBoard markets={[]} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No markets match this view yet."
    );
    // The filter chrome still renders: category row and status chips.
    expect(allButtons()).toHaveLength(2);
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
    fireEvent.click(allButtons()[0]!);

    expect(screen.getByText("Crypto pumps?")).toBeInTheDocument();
    expect(screen.getByText("Sports upset?")).toBeInTheDocument();
  });

  it("marks the active status view's chip", () => {
    render(<DiscoveryBoard activeStatusKey="resolving" markets={boardMarkets()} />);

    expect(screen.getByRole("button", { name: "Resolving" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(allButtons()[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("routes to a chip's status view instead of filtering client-side", () => {
    render(<DiscoveryBoard markets={boardMarkets()} />);

    fireEvent.click(screen.getByRole("button", { name: "Graduating" }));

    expect(routerMock.replace).toHaveBeenCalledWith("/?status=graduating", {
      scroll: false,
    });
    // The markets prop is already the server-filtered page; a chip click must
    // not thin it out locally while the refetch is in flight.
    expect(screen.getByText("Politics shifts?")).toBeInTheDocument();
  });

  it("routes back to the bare board for the All view", () => {
    render(<DiscoveryBoard activeStatusKey="graduating" markets={boardMarkets()} />);

    fireEvent.click(allButtons()[1]!);

    expect(routerMock.replace).toHaveBeenCalledWith("/", { scroll: false });
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
