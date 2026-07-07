import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GraduateMarketButton } from "./graduate-market-button";
import type { GraduateMarketActionResult } from "./graduation-actions";

const mocks = vi.hoisted(() => ({
  graduateMarketAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));

vi.mock("./graduation-actions", () => ({
  graduateMarketAction: mocks.graduateMarketAction,
}));

beforeEach(() => {
  mocks.graduateMarketAction.mockReset();
  mocks.refresh.mockReset();
});

describe("GraduateMarketButton", () => {
  it("shows a pending label while the graduation is in flight", async () => {
    const { resolve } = deferredAction();

    render(<GraduateMarketButton marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Graduate market" }));

    const pending = await screen.findByRole("button", { name: "Graduating" });

    expect(pending).toBeDisabled();

    resolve({ message: "Graduation finalized onchain.", status: "success" });

    await screen.findByRole("button", { name: "Graduate market" });
  });

  it("refreshes the route and reports success", async () => {
    mocks.graduateMarketAction.mockResolvedValueOnce({
      message: "Graduation finalized onchain. Trading is closed.",
      status: "success",
    });

    render(<GraduateMarketButton marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Graduate market" }));

    expect(
      await screen.findByText("Graduation finalized onchain. Trading is closed.")
    ).toBeInTheDocument();
    expect(mocks.graduateMarketAction).toHaveBeenCalledWith("31337:9");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("reports errors without refreshing the route", async () => {
    mocks.graduateMarketAction.mockResolvedValueOnce({
      message: "Could not graduate this market.",
      status: "error",
    });

    render(<GraduateMarketButton marketId="31337:9" />);

    fireEvent.click(screen.getByRole("button", { name: "Graduate market" }));

    expect(
      await screen.findByText("Could not graduate this market.")
    ).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

function deferredAction() {
  let resolve!: (result: GraduateMarketActionResult) => void;

  mocks.graduateMarketAction.mockReturnValueOnce(
    new Promise<GraduateMarketActionResult>((res) => {
      resolve = res;
    })
  );

  return { resolve };
}
