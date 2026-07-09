import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RECEIPT_SLIPPAGE_BPS,
  MAX_RECEIPT_BUDGET_USD,
  type ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";

import type { TradingEnvironment } from "./place-receipt-service";
import {
  getMaxPresetAmount,
  getReceiptAction,
  getReceiptPlacementErrorMessage,
} from "./receipt-action";

describe("getReceiptAction", () => {
  it("locks the receipt book outside bootstrap even while placing", () => {
    const action = getReceiptAction(
      actionInput({ isPlacing: true, marketStatus: "graduating" })
    );

    expect(action).toEqual({
      disabled: true,
      label: "Receipt book locked",
      onClick: undefined,
    });
  });

  it("disables the button while a placement is in flight", () => {
    const action = getReceiptAction(actionInput({ isPlacing: true }));

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Placing receipt");
    expect(action.onClick).toBeUndefined();
  });

  it("disables placement when the amount has a validation error", () => {
    const action = getReceiptAction(
      actionInput({ amountError: "Enter a collateral amount." })
    );

    expect(action).toEqual({
      disabled: true,
      label: "Place YES receipt",
      onClick: undefined,
    });
  });

  it("disables placement when no quote is available", () => {
    const action = getReceiptAction(actionInput({ quote: null }));

    expect(action.disabled).toBe(true);
    expect(action.onClick).toBeUndefined();
  });

  it("allows mock placement without any wallet checks", () => {
    const onPlace = vi.fn();
    const action = getReceiptAction(
      actionInput({
        environment: { kind: "mock" },
        onPlace,
        wallet: walletState({ enabled: false, ready: false }),
      })
    );

    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Place mock YES receipt");
    expect(action.onClick).toBe(onPlace);
  });

  it("reports sign-in unavailable when the wallet integration is disabled", () => {
    const action = getReceiptAction(
      actionInput({ wallet: walletState({ enabled: false }) })
    );

    expect(action).toEqual({
      disabled: true,
      label: "Sign in unavailable",
      onClick: undefined,
    });
  });

  it("waits for the wallet SDK to become ready", () => {
    const action = getReceiptAction(
      actionInput({ wallet: walletState({ ready: false }) })
    );

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Preparing wallet");
  });

  it("offers sign-in when the user is not authenticated", () => {
    const login = vi.fn();
    const action = getReceiptAction(
      actionInput({ wallet: walletState({ authenticated: false, login }) })
    );

    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Sign in to place receipt");
    expect(action.onClick).toBe(login);
  });

  it("offers wallet creation when authenticated without an address", () => {
    const connectOrCreateWallet = vi.fn();
    const action = getReceiptAction(
      actionInput({ wallet: walletState({ address: null, connectOrCreateWallet }) })
    );

    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Create or link wallet");
    expect(action.onClick).toBe(connectOrCreateWallet);
  });

  it("offers a chain switch on an unsupported chain", () => {
    const switchChain = vi.fn(async () => undefined);
    const action = getReceiptAction(
      actionInput({ wallet: walletState({ isSupportedChain: false, switchChain }) })
    );

    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Switch to Hardhat Local");

    action.onClick?.();

    expect(switchChain).toHaveBeenCalledWith(31337);
  });

  it("disables the chain switch while another wallet action is pending", () => {
    const action = getReceiptAction(
      actionInput({
        wallet: walletState({
          isSupportedChain: false,
          pendingAction: "switch-chain:31337",
        }),
      })
    );

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Switch to Hardhat Local");
  });

  it.each([
    ["public", { publicClientReady: false }],
    ["wallet", { walletClientReady: false }],
  ])("waits for the %s client before enabling placement", (_label, overrides) => {
    const action = getReceiptAction(actionInput(overrides));

    expect(action).toEqual({
      disabled: true,
      label: "Preparing trading client",
      onClick: undefined,
    });
  });

  it("blocks placement when the market is missing from the contract", () => {
    const action = getReceiptAction(actionInput({ contractMarketMissing: true }));

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Market not on current contract");
  });

  it("blocks placement on insufficient balance", () => {
    const action = getReceiptAction(actionInput({ insufficientBalance: true }));

    expect(action.disabled).toBe(true);
    expect(action.label).toBe("Insufficient pUSD");
  });

  it("enables placement when nothing blocks it", () => {
    const onPlace = vi.fn();
    const action = getReceiptAction(actionInput({ onPlace, side: "no" }));

    expect(action.disabled).toBe(false);
    expect(action.label).toBe("Place NO receipt");
    expect(action.onClick).toBe(onPlace);
  });
});

describe("getReceiptPlacementErrorMessage", () => {
  it("falls back to generic copy for non-Error values", () => {
    expect(getReceiptPlacementErrorMessage("boom")).toBe("Could not place receipt.");
    expect(getReceiptPlacementErrorMessage(undefined)).toBe("Could not place receipt.");
  });

  it("translates the MarketDoesNotExist revert by name", () => {
    expect(
      getReceiptPlacementErrorMessage(
        new Error('The contract reverted with "MarketDoesNotExist()".')
      )
    ).toBe(
      "This market is not available on the current PregradManager. Create a new local market and try again."
    );
  });

  it("translates the MarketDoesNotExist revert by raw selector", () => {
    expect(
      getReceiptPlacementErrorMessage(
        new Error("Execution reverted with reason: custom error 0x7ff80d38.")
      )
    ).toBe(
      "This market is not available on the current PregradManager. Create a new local market and try again."
    );
  });

  it("returns the fallback for unrecognized errors instead of the raw message", () => {
    expect(getReceiptPlacementErrorMessage(new Error("some raw rpc dump"))).toBe(
      "Could not place receipt."
    );
  });

  it("maps a wallet rejection to shared friendly copy", () => {
    expect(getReceiptPlacementErrorMessage(new Error("User rejected request."))).toBe(
      "Request cancelled in your wallet."
    );
  });
});

describe("getMaxPresetAmount", () => {
  const slippageMultiplier = 1 + DEFAULT_RECEIPT_SLIPPAGE_BPS / 10_000;

  it("falls back to 5,000 when the balance is unknown", () => {
    expect(getMaxPresetAmount(null)).toBe(5_000);
  });

  it("discounts the balance by the default slippage buffer", () => {
    expect(getMaxPresetAmount(1_015)).toBeCloseTo(1_015 / slippageMultiplier, 10);
  });

  it("caps the preset at the receipt budget limit", () => {
    expect(getMaxPresetAmount(MAX_RECEIPT_BUDGET_USD * 10)).toBe(
      MAX_RECEIPT_BUDGET_USD
    );
  });

  it("never returns a negative amount", () => {
    expect(getMaxPresetAmount(-25)).toBe(0);
    expect(getMaxPresetAmount(0)).toBe(0);
  });
});

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const contractEnvironment: TradingEnvironment = {
  config: contractConfig,
  kind: "contract",
  marketId: 7n,
};

function actionInput(
  overrides: Partial<Parameters<typeof getReceiptAction>[0]> = {}
): Parameters<typeof getReceiptAction>[0] {
  return {
    amountError: null,
    contractMarketMissing: false,
    environment: contractEnvironment,
    insufficientBalance: false,
    isPlacing: false,
    marketStatus: "bootstrap",
    onPlace: vi.fn(),
    publicClientReady: true,
    quote: quotePreview(),
    side: "yes",
    wallet: walletState(),
    walletClientReady: true,
    ...overrides,
  };
}

function quotePreview(): ReceiptQuotePreview {
  return {
    averagePriceCents: 52,
    budgetUsd: 100,
    maxCostUsd: 101.5,
    priceBand: { fromProbability: 50, toProbability: 54 },
    priceImpactCents: 4,
    shares: 192,
    side: "yes",
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
