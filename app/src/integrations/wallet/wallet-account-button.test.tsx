import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { WalletAccountButton } from "./wallet-account-button";

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WalletAccountButton when the integration is unavailable", () => {
  it("explains the missing configuration on demand and dismisses on Escape", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ enabled: false }));
    render(<WalletAccountButton />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByText(/wallet login is not configured/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByText(/wallet login is not configured/i)
    ).not.toBeInTheDocument();
  });

  it("shows a disabled loading button while the SDK initializes", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ ready: false }));
    render(<WalletAccountButton />);

    expect(screen.getByRole("button", { name: /wallet/i })).toBeDisabled();
  });

  it("offers login when unauthenticated", () => {
    const login = vi.fn();
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ authenticated: false, login, loginLabel: "Sign in" })
    );
    render(<WalletAccountButton />);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(login).toHaveBeenCalled();
  });
});

describe("WalletAccountButton menu", () => {
  it("toggles the account menu and closes on outside pointer down", () => {
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    expect(screen.getByText("Pop Charts account")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("Pop Charts account")).not.toBeInTheDocument();
  });

  it("labels an unsupported chain as the wrong network", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ isSupportedChain: false })
    );
    render(<WalletAccountButton />);

    expect(screen.getByText("Wrong network")).toBeInTheDocument();
  });

  it("falls back through display address, user label, and a default", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ displayAddress: null, userLabel: "user@example.com" })
    );
    const { unmount } = render(<WalletAccountButton />);

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    unmount();

    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ displayAddress: null, userLabel: null })
    );
    render(<WalletAccountButton />);

    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("surfaces wallet errors inside the menu", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ errorMessage: "Switch rejected." })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());

    expect(screen.getByText("Switch rejected.")).toBeInTheDocument();
  });

  it("switches chains from the network section", () => {
    const switchChain = vi.fn(async () => undefined);
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({
        supportedChains: [
          { id: 31337, name: "Hardhat Local" },
          { id: 5042002, name: "Arc Testnet" },
        ],
        switchChain,
      })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    const active = screen.getByRole("button", { name: "Hardhat Local" });
    const other = screen.getByRole("button", { name: "Arc Testnet" });

    expect(active).toBeDisabled();

    fireEvent.click(other);
    expect(switchChain).toHaveBeenCalledWith(5042002);
  });

  it("marks the pending chain switch with a spinner", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({
        pendingAction: "switch-chain:5042002",
        supportedChains: [
          { id: 31337, name: "Hardhat Local" },
          { id: 5042002, name: "Arc Testnet" },
        ],
      })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());

    // Every chain row is disabled while any wallet action is pending.
    expect(screen.getByRole("button", { name: /arc testnet/i })).toBeDisabled();
  });

  it("activates another connected wallet", () => {
    const setActiveWallet = vi.fn(async () => undefined);
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({
        setActiveWallet,
        wallets: [
          connectedWalletSummary({ active: true }),
          connectedWalletSummary({
            active: false,
            address: "0x2222222222222222222222222222222222222222",
            displayAddress: "0x222...222",
            linked: false,
          }),
        ],
      })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());

    expect(screen.getByText(/unlinked/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /0x222\.\.\.222/i }));
    expect(setActiveWallet).toHaveBeenCalledWith(
      "0x2222222222222222222222222222222222222222"
    );
  });

  it("prompts wallet creation when no wallets are connected", () => {
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());

    expect(
      screen.getByText(/create or link an evm wallet before placing receipts/i)
    ).toBeInTheDocument();
  });

  it("stays open for pointer events inside the menu and non-Escape keys", () => {
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    fireEvent.pointerDown(screen.getByText("Pop Charts account"));
    fireEvent.keyDown(document, { key: "Tab" });

    expect(screen.getByText("Pop Charts account")).toBeInTheDocument();

    // A pointer event without a DOM node target must not close it either.
    fireEvent.pointerDown(window);
    expect(screen.getByText("Pop Charts account")).toBeInTheDocument();
  });

  it("falls back to the default chain name when the active chain is unnamed", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ activeChainName: null }));
    render(<WalletAccountButton />);

    expect(screen.getByText("Hardhat Local")).toBeInTheDocument();
  });

  it("labels the account header when no wallet is linked", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ displayAddress: null, userLabel: null })
    );
    render(<WalletAccountButton />);

    fireEvent.click(screen.getByRole("button", { name: /account/i }));

    expect(screen.getByText("No wallet linked")).toBeInTheDocument();
  });

  it("marks the unsupported network in the account header", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ isSupportedChain: false })
    );
    render(<WalletAccountButton />);

    fireEvent.click(screen.getByRole("button", { name: /0x111\.\.\.111/i }));

    expect(screen.getByText("Pop Charts account")).toBeInTheDocument();
  });

  it("shows a spinner on the wallet being activated", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({
        pendingAction: "set-active:0x2222222222222222222222222222222222222222",
        wallets: [
          connectedWalletSummary({ active: true }),
          connectedWalletSummary({
            active: false,
            address: "0x2222222222222222222222222222222222222222",
            displayAddress: "0x222...222",
          }),
        ],
      })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());

    expect(screen.getByRole("button", { name: /0x222\.\.\.222/i })).toBeDisabled();
  });

  it("copies the address and reports the copy transiently", async () => {
    const copyAddress = vi.fn(async () => undefined);
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ copyAddress }));
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    expect(copyAddress).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copied address/i })
      ).toBeInTheDocument()
    );
  });

  it("links another wallet and disconnects", () => {
    const linkWallet = vi.fn();
    const logout = vi.fn(async () => undefined);
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ linkWallet, logout }));
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole("button", { name: /link another wallet/i }));
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(linkWallet).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
  });

  it("shows pending spinners for link and logout actions", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ pendingAction: "link-wallet" })
    );
    const { unmount } = render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    expect(screen.getByRole("button", { name: /link another wallet/i })).toBeDisabled();
    unmount();

    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ pendingAction: "logout" })
    );
    render(<WalletAccountButton />);

    fireEvent.click(menuButton());
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeDisabled();
  });
});

function menuButton() {
  return screen.getByRole("button", { name: /0x111\.\.\.111/i });
}

function connectedWalletSummary(
  overrides: Partial<WalletAccountValue["wallets"][number]> = {}
) {
  return {
    active: true,
    address: "0x1111111111111111111111111111111111111111",
    chainId: 31337,
    displayAddress: "0x111...111",
    label: "Privy",
    linked: true,
    walletClientType: "privy",
    ...overrides,
  };
}

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
