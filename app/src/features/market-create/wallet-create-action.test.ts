import { describe, expect, it, vi } from "vitest";

import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";

import { getWalletCreateAction } from "./wallet-create-action";

describe("getWalletCreateAction", () => {
  it("asks for wallet configuration when the integration is disabled", () => {
    const action = getWalletCreateAction(
      input({ wallet: walletState({ enabled: false }) })
    );

    expect(action.kind).toBe("waiting");
    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Configure wallet");
    expect(action.message).toBe(
      "Wallet signing is required for devchain market creation."
    );
  });

  it("waits while the wallet SDK loads", () => {
    const action = getWalletCreateAction(
      input({ wallet: walletState({ ready: false }) })
    );

    expect(action.kind).toBe("waiting");
    expect(action.label).toBe("Preparing wallet");
    expect(action.message).toBe("Wallet state is still loading.");
  });

  it("blocks creation while another wallet action is pending", () => {
    const action = getWalletCreateAction(
      input({ wallet: walletState({ pendingAction: "logout" }) })
    );

    expect(action.kind).toBe("waiting");
    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Wallet pending...");
  });

  it("offers login when unauthenticated", () => {
    const login = vi.fn();
    const action = getWalletCreateAction(
      input({ wallet: walletState({ authenticated: false, login }) })
    );

    expect(action.kind).toBe("connect");
    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Connect wallet");
    expect(action.run).toBe(login);
  });

  it("offers wallet creation when authenticated without an address", () => {
    const connectOrCreateWallet = vi.fn();
    const action = getWalletCreateAction(
      input({ wallet: walletState({ address: null, connectOrCreateWallet }) })
    );

    expect(action.kind).toBe("connect");
    expect(action.label).toBe("Add wallet");
    expect(action.run).toBe(connectOrCreateWallet);
  });

  it("reports incomplete devchain configuration", () => {
    const action = getWalletCreateAction(input({ contractChainId: null }));

    expect(action.kind).toBe("waiting");
    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Configure devchain");
    expect(action.message).toBe("Devchain contract configuration is incomplete.");
  });

  it("offers a chain switch on an unsupported chain", () => {
    const switchChain = vi.fn(async () => undefined);
    const action = getWalletCreateAction(
      input({ wallet: walletState({ isSupportedChain: false, switchChain }) })
    );

    expect(action.kind).toBe("switch-chain");
    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Switch to Hardhat Local");

    action.run();

    expect(switchChain).toHaveBeenCalledWith(31337);
  });

  it("offers a chain switch when the wallet sits on a different supported chain", () => {
    const switchChain = vi.fn(async () => undefined);
    const action = getWalletCreateAction(
      input({
        contractChainId: 31337,
        wallet: walletState({ activeChainId: 1, switchChain }),
      })
    );

    expect(action.kind).toBe("switch-chain");

    action.run();

    expect(switchChain).toHaveBeenCalledWith(31337);
  });

  it.each([
    ["public", { publicClientReady: false }],
    ["wallet", { walletClientReady: false }],
  ])("waits for the %s client", (_label, overrides) => {
    const action = getWalletCreateAction(input(overrides));

    expect(action.kind).toBe("waiting");
    expect(action.disabled).toBe(true);
    expect(action.message).toBe("Waiting for the connected wallet client.");
  });

  it("is ready to sign when nothing blocks creation", () => {
    const action = getWalletCreateAction(input());

    expect(action.kind).toBe("ready");
    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Create market");
    expect(() => action.run()).not.toThrow();
  });
});

function input(
  overrides: Partial<Parameters<typeof getWalletCreateAction>[0]> = {}
): Parameters<typeof getWalletCreateAction>[0] {
  return {
    contractChainId: 31337,
    publicClientReady: true,
    wallet: walletState(),
    walletClientReady: true,
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
