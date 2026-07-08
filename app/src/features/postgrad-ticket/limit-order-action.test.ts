import { describe, expect, it, vi } from "vitest";

import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";

import { getLimitOrderAction, getLimitOrderErrorMessage } from "./limit-order-action";
import {
  LIMIT_PRICE_OUT_OF_BAND_MESSAGE,
  LIMIT_WOULD_CROSS_MESSAGE,
} from "./limit-order-service";
import type { VenueTradingEnvironment } from "./postgrad-swap-service";

describe("getLimitOrderAction", () => {
  it("disables the button while a placement is in flight", () => {
    const action = buildAction({ isPlacing: true });

    expect(action).toEqual({
      disabled: true,
      label: "Placing order",
      onClick: undefined,
    });
  });

  it("keeps the place label but disables on a field error", () => {
    const action = buildAction({ fieldError: "Enter a limit price in cents." });

    expect(action).toEqual({
      disabled: true,
      label: "Place limit order",
      onClick: undefined,
    });
  });

  it("stays a disabled preview in the mock environment", () => {
    const action = buildAction({ environment: { kind: "mock" } });

    expect(action).toEqual({
      disabled: true,
      label: "Preview only - no venue connected",
      onClick: undefined,
    });
  });

  it("reports a deployment without an order manager", () => {
    const action = buildAction({ orderManagerConfigured: false });

    expect(action).toEqual({
      disabled: true,
      label: "Limit orders unavailable",
      onClick: undefined,
    });
  });

  it("defers to the shared wallet gate", () => {
    const wallet = walletState({ authenticated: false });
    const action = buildAction({ wallet });

    expect(action).toEqual({
      disabled: false,
      label: "Sign in to trade",
      onClick: wallet.login,
    });
  });

  it("offers a chain switch on the wrong network", () => {
    const wallet = walletState({ isSupportedChain: false });
    const action = buildAction({ wallet });

    expect(action.label).toBe("Switch to Hardhat Local");
    expect(action.disabled).toBe(false);

    action.onClick?.();

    expect(wallet.switchChain).toHaveBeenCalledWith(31337);
  });

  it("waits for the trading clients", () => {
    const action = buildAction({ publicClientReady: false });

    expect(action.label).toBe("Preparing trading client");
    expect(action.disabled).toBe(true);
  });

  it("names the collateral on an underfunded bid", () => {
    const action = buildAction({ insufficientBalance: true });

    expect(action).toEqual({
      disabled: true,
      label: "Insufficient pUSD",
      onClick: undefined,
    });
  });

  it("names the outcome tokens on an underfunded ask", () => {
    const action = buildAction({ insufficientBalance: true, spendLabel: "tokens" });

    expect(action).toEqual({
      disabled: true,
      label: "Insufficient YES tokens",
      onClick: undefined,
    });
  });

  it("enables placement when nothing blocks", () => {
    const onPlace = vi.fn();
    const action = buildAction({ onPlace });

    expect(action).toEqual({
      disabled: false,
      label: "Place limit order",
      onClick: onPlace,
    });
  });
});

describe("getLimitOrderErrorMessage", () => {
  it.each([
    {
      expected: LIMIT_WOULD_CROSS_MESSAGE,
      message: "execution reverted: InvalidOrderSide(true, -120, -60, 0)",
    },
    {
      expected: LIMIT_WOULD_CROSS_MESSAGE,
      message: "carrier error data fb6bb2a5 embedded mid-string",
    },
    {
      expected:
        "This order is below the venue's minimum order size. Increase the size.",
      message: "InvalidAmount()",
    },
    {
      expected:
        "This order is below the venue's minimum order size. Increase the size.",
      message: "raw revert 2c5211c6",
    },
    {
      expected: "This order is too small to rest at that price. Increase the size.",
      message: "InvalidLiquidity()",
    },
    {
      expected: "This order has already been filled or cancelled.",
      message: "OrderNotFound(0x11, 9)",
    },
    {
      expected: "This order has already been filled or cancelled.",
      message: "unrecognized selector a0b1d457 in error data",
    },
  ])("maps $message", ({ expected, message }) => {
    expect(getLimitOrderErrorMessage(new Error(message))).toBe(expected);
  });

  it("maps the bounded hook's price-band revert to the band copy", () => {
    expect(
      getLimitOrderErrorMessage(new Error("PoolTickOutOfBounds(0x11, -200, -120, 0)"))
    ).toBe(LIMIT_PRICE_OUT_OF_BAND_MESSAGE);
  });

  it("passes ordinary errors through and falls back on non-errors", () => {
    expect(getLimitOrderErrorMessage(new Error("rpc down"))).toBe("rpc down");
    expect(getLimitOrderErrorMessage("boom")).toBe("Could not place the order.");
  });
});

function buildAction(
  overrides: Partial<Parameters<typeof getLimitOrderAction>[0]> = {}
) {
  return getLimitOrderAction({
    environment: contractEnvironment(),
    fieldError: null,
    insufficientBalance: false,
    isPlacing: false,
    onPlace: vi.fn(),
    orderManagerConfigured: true,
    publicClientReady: true,
    sideLabel: "YES",
    spendLabel: "pUSD",
    wallet: walletState(),
    walletClientReady: true,
    ...overrides,
  });
}

function contractEnvironment(): VenueTradingEnvironment {
  return {
    config: {
      chainEnv: "local",
      chainId: 31337,
      collateralAddress: "0x0000000000000000000000000000000000000002",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      pregradManagerAddress: "0x0000000000000000000000000000000000000001",
      rpcUrl: "http://127.0.0.1:8545",
    },
    kind: "contract",
    venue: {
      boundedHookAddress: "0x00000000000000000000000000000000000000f1",
      live: true,
      noPool: {
        initialized: true,
        outcomeTokenAddress: "0x0000000000000000000000000000000000000004",
        poolId: `0x${"22".repeat(32)}`,
        whitelisted: true,
      },
      orderManagerAddress: "0x00000000000000000000000000000000000000f2",
      poolManagerAddress: "0x00000000000000000000000000000000000000f0",
      yesPool: {
        initialized: true,
        outcomeTokenAddress: "0x0000000000000000000000000000000000000003",
        poolId: `0x${"11".repeat(32)}`,
        whitelisted: true,
      },
    },
    venueConfig: {
      orderManagerAddress: "0x00000000000000000000000000000000000000f2",
      poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
      quoterAddress: null,
      stateViewAddress: null,
      swapRouterAddress: "0x00000000000000000000000000000000000000b1",
    },
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
