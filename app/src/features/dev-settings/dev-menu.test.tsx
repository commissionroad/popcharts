import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setRevealRawErrors } from "@/lib/error-handling";

import { DevMenu } from "./dev-menu";

const mocks = vi.hoisted(() => ({
  closePregradMarketAction: vi.fn(),
  forceGraduateMarketAction: vi.fn(),
  pathname: vi.fn((): string => "/"),
  refresh: vi.fn(),
  useTestPusdMint: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));

vi.mock("@/features/market-detail/dev-market-actions", () => ({
  closePregradMarketAction: mocks.closePregradMarketAction,
}));

vi.mock("@/features/market-detail/graduation-actions", () => ({
  forceGraduateMarketAction: mocks.forceGraduateMarketAction,
}));

vi.mock("./use-test-pusd-mint", () => ({
  useTestPusdMint: mocks.useTestPusdMint,
}));

const STORAGE_KEY = "popcharts:dev:reveal-raw-errors:v1";

beforeEach(() => {
  mocks.closePregradMarketAction.mockReset();
  mocks.forceGraduateMarketAction.mockReset();
  mocks.refresh.mockReset();
  mocks.pathname.mockReturnValue("/");
  mocks.useTestPusdMint.mockReturnValue(testPusdMintState());
});

afterEach(() => {
  window.localStorage.clear();
  setRevealRawErrors(false);
});

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Dev tools" }));
}

describe("DevMenu", () => {
  it("keeps the menu closed until the gear is clicked", () => {
    render(<DevMenu />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    open();

    expect(
      screen.getByRole("switch", { name: /Reveal raw errors/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Force graduate/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Close for refunds/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get pUSD/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dev tools" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("disables the market actions off a market page", () => {
    mocks.pathname.mockReturnValue("/portfolio");
    render(<DevMenu />);
    open();

    expect(screen.getByRole("button", { name: /Force graduate/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Close for refunds/ })).toBeDisabled();
    expect(screen.getByText("Open a market to use these.")).toBeInTheDocument();
  });

  it("toggles the reveal-raw-errors override and persists it", () => {
    render(<DevMenu />);
    open();

    const toggle = screen.getByRole("switch", { name: /Reveal raw errors/ });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("runs the pUSD mint action from the wallet section", () => {
    const onClick = vi.fn();
    mocks.useTestPusdMint.mockReturnValue(
      testPusdMintState({ action: { disabled: false, label: "Get pUSD", onClick } })
    );

    render(<DevMenu />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Get pUSD/ }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the pUSD mint result", () => {
    mocks.useTestPusdMint.mockReturnValue(
      testPusdMintState({
        result: {
          message: "Added 10,000 test pUSD to your wallet.",
          status: "success",
        },
      })
    );

    render(<DevMenu />);
    open();

    expect(
      screen.getByText("Added 10,000 test pUSD to your wallet.")
    ).toBeInTheDocument();
  });

  it("hydrates the reveal toggle from persisted storage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    render(<DevMenu />);
    open();

    expect(screen.getByRole("switch", { name: /Reveal raw errors/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("force graduates the current market and refreshes on success", async () => {
    mocks.pathname.mockReturnValue("/markets/31337%3A9");
    mocks.forceGraduateMarketAction.mockResolvedValueOnce({
      message: "Forced graduation settled onchain.",
      status: "success",
    });

    render(<DevMenu />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Force graduate/ }));

    expect(
      await screen.findByText("Forced graduation settled onchain.")
    ).toBeInTheDocument();
    expect(mocks.forceGraduateMarketAction).toHaveBeenCalledWith("31337:9");
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("closes the current market for refunds", async () => {
    mocks.pathname.mockReturnValue("/markets/31337%3A9/graduation");
    mocks.closePregradMarketAction.mockResolvedValueOnce({
      message: "Closed for refunds.",
      status: "success",
    });

    render(<DevMenu />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Close for refunds/ }));

    expect(await screen.findByText("Closed for refunds.")).toBeInTheDocument();
    expect(mocks.closePregradMarketAction).toHaveBeenCalledWith("31337:9");
  });

  it("reports action errors without refreshing", async () => {
    mocks.pathname.mockReturnValue("/markets/31337%3A9");
    mocks.forceGraduateMarketAction.mockResolvedValueOnce({
      message: "Could not graduate this market.",
      status: "error",
    });

    render(<DevMenu />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Force graduate/ }));

    expect(
      await screen.findByText("Could not graduate this market.")
    ).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("shows a pending label while an action is in flight", async () => {
    mocks.pathname.mockReturnValue("/markets/31337%3A9");
    let resolveAction!: (result: unknown) => void;
    mocks.forceGraduateMarketAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAction = resolve;
      })
    );

    render(<DevMenu />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Force graduate/ }));

    const pending = await screen.findAllByRole("button", { name: "Working" });
    expect(pending[0]).toBeDisabled();

    resolveAction({ message: "Forced graduation settled onchain.", status: "success" });
    await screen.findByText("Forced graduation settled onchain.");
  });

  it("decodes an unparseable market segment without throwing", () => {
    mocks.pathname.mockReturnValue("/markets/%");
    render(<DevMenu />);
    open();

    // A malformed segment still yields an enabled action (best-effort id).
    expect(screen.getByRole("button", { name: /Force graduate/ })).not.toBeDisabled();
  });
});

function testPusdMintState(
  overrides: Partial<
    ReturnType<typeof import("./use-test-pusd-mint").useTestPusdMint>
  > = {}
): ReturnType<typeof import("./use-test-pusd-mint").useTestPusdMint> {
  return {
    action: { disabled: false, label: "Get pUSD", onClick: vi.fn() },
    isMinting: false,
    result: null,
    ...overrides,
  };
}
