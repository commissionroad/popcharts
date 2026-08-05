import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { DiscoveryPage } from "./discovery-page";

const getMarkets = vi.hoisted(() => vi.fn());
const usesFixtureMarkets = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/domain/markets/queries", () => ({
  getMarkets,
  usesFixtureMarkets,
}));

// The page mounts the live-refresh island and the board, which call
// useRouter(); these cases assert the page's own markup, and each island's
// behaviour has its own test. Without a mounted app router, useRouter throws
// an invariant.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

describe("DiscoveryPage", () => {
  it("renders the heading and the fetched markets", async () => {
    getMarkets.mockResolvedValueOnce([
      marketFactory({ id: "m-1", question: "Will the page render?" }),
    ]);

    render(await DiscoveryPage());

    expect(
      screen.getByRole("heading", { name: "Markets popping off" })
    ).toBeInTheDocument();
    expect(screen.getByText("Will the page render?")).toBeInTheDocument();
    // The default view asks for an unfiltered list.
    expect(getMarkets).toHaveBeenCalledWith({ statuses: [] });
  });

  it("fetches the active status view server-side and marks its chip", async () => {
    getMarkets.mockResolvedValueOnce([marketFactory({ id: "m-1" })]);

    render(
      await DiscoveryPage({
        statusFilter: {
          key: "resolving",
          label: "Resolving",
          statuses: ["resolution_pending", "disputed"],
        },
      })
    );

    expect(getMarkets).toHaveBeenCalledWith({
      statuses: ["resolution_pending", "disputed"],
    });
    expect(screen.getByRole("button", { name: "Resolving" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("renders an empty board when no markets are returned", async () => {
    getMarkets.mockResolvedValueOnce([]);

    render(await DiscoveryPage());

    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("labels fixture-backed markets as sample data", async () => {
    getMarkets.mockResolvedValueOnce([marketFactory({ id: "m-1" })]);
    usesFixtureMarkets.mockReturnValueOnce(true);

    render(await DiscoveryPage());

    expect(screen.getByRole("note")).toHaveTextContent(/sample data/i);
  });

  it("shows no sample-data note for live market data", async () => {
    getMarkets.mockResolvedValueOnce([marketFactory({ id: "m-1" })]);
    usesFixtureMarkets.mockReturnValueOnce(false);

    render(await DiscoveryPage());

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
