import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateMarketPage } from "./create-market-page";

vi.mock("@/features/market-create/create-market-form", () => ({
  CreateMarketForm: ({ initialNow }: { initialNow: string }) => (
    <div>Create market form seeded at {initialNow}</div>
  ),
}));

describe("CreateMarketPage", () => {
  it("renders the launchpad intro and threads initialNow into the form", () => {
    render(<CreateMarketPage initialNow="2030-07-01T12:00:00.000Z" />);

    expect(screen.getByRole("heading", { name: "Bake a market" })).toBeInTheDocument();
    expect(screen.getByText("Launchpad")).toBeInTheDocument();
    expect(
      screen.getByText("Create market form seeded at 2030-07-01T12:00:00.000Z")
    ).toBeInTheDocument();
  });
});
