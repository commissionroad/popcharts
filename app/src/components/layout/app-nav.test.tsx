import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";

import { AppNav } from "./app-nav";

const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn((): string => "/"),
}));

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: () => walletState(),
}));

// The dev menu pulls in server actions; the nav only decides whether to mount it.
vi.mock("@/features/dev-settings/dev-menu", () => ({
  DevMenu: () => <div data-testid="dev-menu" />,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AppNav", () => {
  it("marks Discover current on the home page and offers market creation", () => {
    pathnameMock.mockReturnValue("/");
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Create" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("link", { name: "Portfolio" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("link", { name: /Pop a market/ })).toHaveAttribute(
      "href",
      "/create"
    );
  });

  it("keeps Discover current on market detail pages", () => {
    pathnameMock.mockReturnValue("/markets/eth-5000-august");
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("marks Portfolio current on the portfolio page", () => {
    pathnameMock.mockReturnValue("/portfolio");
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Discover" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("hides the create button on the create page itself", () => {
    pathnameMock.mockReturnValue("/create");
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.queryByRole("link", { name: /Pop a market/ })
    ).not.toBeInTheDocument();
  });

  it("links the logo back home", () => {
    pathnameMock.mockReturnValue("/portfolio");
    render(<AppNav />);

    expect(screen.getByRole("link", { name: "Pop Charts home" })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("hides the dev menu unless dev tools are enabled", () => {
    pathnameMock.mockReturnValue("/");
    render(<AppNav />);

    expect(screen.queryByTestId("dev-menu")).not.toBeInTheDocument();
  });

  it("mounts the dev menu when dev tools are enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED", "true");
    pathnameMock.mockReturnValue("/");
    render(<AppNav />);

    expect(screen.getByTestId("dev-menu")).toBeInTheDocument();
  });
});

function walletState(overrides: Partial<WalletAccountValue> = {}): WalletAccountValue {
  return {
    activeChainId: 31337,
    activeChainName: "Hardhat Local",
    address: "0x1111111111111111111111111111111111111111",
    authenticated: true,
    clearError: () => undefined,
    connectOrCreateWallet: vi.fn(),
    copyAddress: async () => undefined,
    defaultChain: { id: 31337, name: "Hardhat Local" },
    displayAddress: "0x111...111",
    enabled: true,
    errorMessage: null,
    isSupportedChain: true,
    linkWallet: () => undefined,
    login: vi.fn(),
    loginLabel: "Sign in",
    logout: async () => undefined,
    pendingAction: null,
    ready: true,
    setActiveWallet: async () => undefined,
    supportedChains: [{ id: 31337, name: "Hardhat Local" }],
    switchChain: vi.fn(async () => undefined),
    userLabel: null,
    wallets: [],
    ...overrides,
  };
}
