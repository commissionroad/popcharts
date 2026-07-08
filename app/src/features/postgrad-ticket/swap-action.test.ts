import { describe, expect, it, vi } from "vitest";

import type { VenueSwapQuote } from "@/domain/postgrad-trading/venue-trade";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";

import type { VenueTradingEnvironment } from "./postgrad-swap-service";
import {
  getMaxVenueTradeAmount,
  getVenueSwapAction,
  getVenueSwapErrorMessage,
  POOL_TICK_OUT_OF_BOUNDS_SELECTOR,
  PRICE_BOUND_REACHED_MESSAGE,
} from "./swap-action";

const WAD = 10n ** 18n;

describe("getVenueSwapAction", () => {
  it("disables the button while a swap is in flight", () => {
    const action = buildAction({ isSwapping: true });

    expect(action).toEqual({
      disabled: true,
      label: "Placing order",
      onClick: undefined,
    });
  });

  it("keeps the trade label but disables without a quote", () => {
    const action = buildAction({ quote: null });

    expect(action).toEqual({
      disabled: true,
      label: "Buy YES tokens",
      onClick: undefined,
    });
  });

  it("disables on an amount error", () => {
    const action = buildAction({ amountError: "Enter a collateral amount." });

    expect(action.disabled).toBe(true);
    expect(action.onClick).toBeUndefined();
  });

  it("stays a disabled preview in the mock environment", () => {
    const action = buildAction({ environment: { kind: "mock" } });

    expect(action).toEqual({
      disabled: true,
      label: "Preview only - no venue connected",
      onClick: undefined,
    });
  });

  it("reports when sign-in is unavailable", () => {
    const action = buildAction({ wallet: walletState({ enabled: false }) });

    expect(action.label).toBe("Sign in unavailable");
    expect(action.disabled).toBe(true);
  });

  it("waits for the wallet provider to become ready", () => {
    const action = buildAction({ wallet: walletState({ ready: false }) });

    expect(action.label).toBe("Preparing wallet");
  });

  it("offers login when unauthenticated", () => {
    const wallet = walletState({ authenticated: false });
    const action = buildAction({ wallet });

    expect(action).toEqual({
      disabled: false,
      label: "Sign in to trade",
      onClick: wallet.login,
    });
  });

  it("offers wallet creation without an address", () => {
    const wallet = walletState({ address: null });
    const action = buildAction({ wallet });

    expect(action.label).toBe("Create or link wallet");
    expect(action.onClick).toBe(wallet.connectOrCreateWallet);
  });

  it("offers a chain switch on an unsupported chain", () => {
    const wallet = walletState({ isSupportedChain: false });
    const action = buildAction({ wallet });

    expect(action.label).toBe("Switch to Hardhat Local");
    expect(action.disabled).toBe(false);

    action.onClick?.();

    expect(wallet.switchChain).toHaveBeenCalledWith(31337);
  });

  it("disables the chain switch while one is pending", () => {
    const wallet = walletState({
      isSupportedChain: false,
      pendingAction: "switch-chain:31337",
    });

    expect(buildAction({ wallet }).disabled).toBe(true);
  });

  it("waits for viem clients", () => {
    expect(buildAction({ publicClientReady: false }).label).toBe(
      "Preparing trading client"
    );
    expect(buildAction({ walletClientReady: false }).label).toBe(
      "Preparing trading client"
    );
  });

  it("blocks buys on insufficient collateral", () => {
    const action = buildAction({ insufficientBalance: true });

    expect(action).toEqual({
      disabled: true,
      label: "Insufficient pUSD",
      onClick: undefined,
    });
  });

  it("blocks sells on insufficient outcome tokens", () => {
    const action = buildAction({
      action: "sell",
      insufficientBalance: true,
      quote: quoteFixture({ action: "sell" }),
    });

    expect(action.label).toBe("Insufficient YES tokens");
  });

  it("enables the swap when nothing blocks it", () => {
    const onSwap = vi.fn();
    const action = buildAction({ onSwap });

    expect(action).toEqual({
      disabled: false,
      label: "Buy YES tokens",
      onClick: onSwap,
    });
  });

  it("labels sells with the sell verb", () => {
    const action = buildAction({
      action: "sell",
      quote: quoteFixture({ action: "sell" }),
    });

    expect(action.label).toBe("Sell YES tokens");
  });
});

describe("getVenueSwapErrorMessage", () => {
  it("maps the PoolTickOutOfBounds revert to the price-bound copy", () => {
    expect(
      getVenueSwapErrorMessage(new Error("execution reverted: PoolTickOutOfBounds"))
    ).toBe(PRICE_BOUND_REACHED_MESSAGE);
  });

  it("maps the raw error selector to the price-bound copy", () => {
    // The quoter wraps the hook revert in carrier errors whose raw bytes
    // embed the selector mid-string, without a 0x prefix.
    expect(
      getVenueSwapErrorMessage(
        new Error(
          `reverted with custom error 'UnexpectedRevertBytes("0x90bfb865aaaa${POOL_TICK_OUT_OF_BOUNDS_SELECTOR}ffff")'`
        )
      )
    ).toBe(PRICE_BOUND_REACHED_MESSAGE);
  });

  it("passes other error messages through", () => {
    expect(getVenueSwapErrorMessage(new Error("nope"))).toBe("nope");
  });

  it("falls back for non-Error values", () => {
    expect(getVenueSwapErrorMessage("boom")).toBe("Could not place the order.");
  });
});

describe("getMaxVenueTradeAmount", () => {
  it("falls back to 5,000 while the balance is unknown", () => {
    expect(getMaxVenueTradeAmount({ balance: null, maxAmount: 1_000_000 })).toBe(5_000);
  });

  it("uses the balance up to the per-trade cap", () => {
    expect(getMaxVenueTradeAmount({ balance: 123.45, maxAmount: 1_000_000 })).toBe(
      123.45
    );
    expect(getMaxVenueTradeAmount({ balance: 2_000_000, maxAmount: 1_000_000 })).toBe(
      1_000_000
    );
  });

  it("never returns a negative amount", () => {
    expect(getMaxVenueTradeAmount({ balance: -3, maxAmount: 1_000_000 })).toBe(0);
  });
});

function buildAction(
  overrides: Partial<Parameters<typeof getVenueSwapAction>[0]> = {}
) {
  return getVenueSwapAction({
    action: "buy",
    amountError: null,
    environment: contractEnvironment(),
    insufficientBalance: false,
    isSwapping: false,
    onSwap: vi.fn(),
    publicClientReady: true,
    quote: quoteFixture(),
    sideLabel: "YES",
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
        outcomeTokenAddress: "0x00000000000000000000000000000000000000f3",
        poolId: `0x${"22".repeat(32)}`,
        whitelisted: true,
      },
      orderManagerAddress: "0x00000000000000000000000000000000000000f2",
      poolManagerAddress: "0x00000000000000000000000000000000000000f0",
      yesPool: {
        initialized: true,
        outcomeTokenAddress: "0x00000000000000000000000000000000000000f4",
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

function quoteFixture(overrides: Partial<VenueSwapQuote> = {}): VenueSwapQuote {
  return {
    action: "buy",
    amountIn: 100n * WAD,
    amountOut: 190n * WAD,
    effectivePriceCents: 52.6,
    poolPriceCents: 52,
    side: "yes",
    source: "quoter",
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
