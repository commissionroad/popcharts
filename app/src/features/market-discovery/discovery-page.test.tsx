import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { DiscoveryPage } from "./discovery-page";

const getMarkets = vi.hoisted(() => vi.fn());

vi.mock("@/domain/markets/queries", () => ({
  getMarkets,
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
  });

  it("renders an empty board when no markets are returned", async () => {
    getMarkets.mockResolvedValueOnce([]);

    render(await DiscoveryPage());

    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
