import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarketDevSettings } from "./market-dev-settings";

const mocks = vi.hoisted(() => ({
  closePregradMarketAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));

vi.mock("./dev-market-actions", () => ({
  closePregradMarketAction: mocks.closePregradMarketAction,
}));

beforeEach(() => {
  mocks.closePregradMarketAction.mockReset();
  mocks.refresh.mockReset();
});

describe("MarketDevSettings", () => {
  it("keeps the popover closed until the settings button is clicked", () => {
    render(<MarketDevSettings canClosePregrad marketId="31337:9" />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("reveals the close action only after dev settings are switched on", () => {
    render(<MarketDevSettings canClosePregrad marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));

    expect(
      screen.queryByRole("button", { name: /Close for refunds/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("button", { name: /Close for refunds/ })
    ).toBeInTheDocument();
  });

  it("never offers the close action when the market cannot be closed", () => {
    render(<MarketDevSettings canClosePregrad={false} marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));
    fireEvent.click(screen.getByRole("switch"));

    expect(
      screen.queryByRole("button", { name: /Close for refunds/ })
    ).not.toBeInTheDocument();
  });

  it("closes the market, reports success, and refreshes the route", async () => {
    mocks.closePregradMarketAction.mockResolvedValueOnce({
      message: "Closed for refunds.",
      status: "success",
    });

    render(<MarketDevSettings canClosePregrad marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Close for refunds/ }));

    expect(await screen.findByText("Closed for refunds.")).toBeInTheDocument();
    expect(mocks.closePregradMarketAction).toHaveBeenCalledWith("31337:9");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("shows a pending label while the close is in flight", async () => {
    let resolveClose!: (result: unknown) => void;
    mocks.closePregradMarketAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClose = resolve;
      })
    );

    render(<MarketDevSettings canClosePregrad marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Close for refunds/ }));

    const pending = await screen.findByRole("button", { name: /Closing/ });

    expect(pending).toBeDisabled();

    resolveClose({ message: "Closed for refunds.", status: "success" });

    await screen.findByText("Closed for refunds.");
  });

  it("reports errors without refreshing and clears them when the switch toggles", async () => {
    mocks.closePregradMarketAction.mockResolvedValueOnce({
      message: "Could not close this market for refunds.",
      status: "error",
    });

    render(<MarketDevSettings canClosePregrad marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Market settings" }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Close for refunds/ }));

    expect(
      await screen.findByText("Could not close this market for refunds.")
    ).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch"));

    expect(
      screen.queryByText("Could not close this market for refunds.")
    ).not.toBeInTheDocument();
  });
});
