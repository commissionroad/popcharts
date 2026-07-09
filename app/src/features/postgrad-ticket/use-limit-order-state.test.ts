import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import type { Market } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { useVenueBalances } from "@/integrations/contracts/hooks/use-venue-balances";
import type { PostgradVenueContractConfig } from "@/integrations/contracts/postgrad-venue";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { DisplayableError } from "@/lib/error-handling";
import { marketFactory } from "@/test/factories/markets";

import {
  placeVenueLimitOrder,
  type VenueLimitOrderReceipt,
} from "./limit-order-service";
import {
  buildVenuePoolContext,
  resolveVenueTradingEnvironment,
  type VenuePoolContext,
  type VenueTradingEnvironment,
} from "./postgrad-swap-service";
import { useLimitOrderState } from "./use-limit-order-state";

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(),
  useWalletClient: vi.fn(),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/integrations/contracts/hooks/use-venue-balances", () => ({
  useVenueBalances: vi.fn(),
}));

vi.mock("./limit-order-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./limit-order-service")>()),
  cancelVenueLimitOrder: vi.fn(),
  placeVenueLimitOrder: vi.fn(),
}));

vi.mock("./postgrad-swap-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./postgrad-swap-service")>()),
  buildVenuePoolContext: vi.fn(),
  resolveVenueTradingEnvironment: vi.fn(),
}));

const routerMock = { push: vi.fn(), refresh: vi.fn() };

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const venueConfig: PostgradVenueContractConfig = {
  orderManagerAddress: "0x00000000000000000000000000000000000000f2",
  poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
  quoterAddress: null,
  stateViewAddress: null,
  swapRouterAddress: "0x00000000000000000000000000000000000000b1",
};

beforeEach(() => {
  vi.mocked(usePublicClient).mockReturnValue({
    kind: "public-client",
  } as unknown as ReturnType<typeof usePublicClient>);
  vi.mocked(useWalletClient).mockReturnValue({
    data: { kind: "wallet-client" },
  } as unknown as ReturnType<typeof useWalletClient>);
  vi.mocked(resolveVenueTradingEnvironment).mockReturnValue(contractEnvironment());
  vi.mocked(buildVenuePoolContext).mockImplementation(({ side }) =>
    poolContext(side === "yes")
  );
  vi.mocked(placeVenueLimitOrder).mockResolvedValue(orderReceipt());
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useVenueBalances).mockReturnValue({
    collateral: 100_000n * WAD,
    error: null,
    loading: false,
    no: 40n * WAD,
    yes: 60n * WAD,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useLimitOrderState form state", () => {
  it("starts as an empty-price YES buy asking for a limit price", () => {
    const { result } = renderTicket();

    expect(result.current.action).toBe("buy");
    expect(result.current.side).toBe("yes");
    expect(result.current.priceInput).toBe("");
    expect(result.current.sizeInput).toBe("100");
    expect(result.current.priceFieldError).toBe("Enter a limit price in cents.");
    expect(result.current.quote).toBeNull();
    expect(result.current.placeAction.disabled).toBe(true);
  });

  it("builds the deposit quote for a valid resting bid", () => {
    const { result } = renderTicket();

    act(() => {
      // The YES pool fixture trades at 88c; a 30c bid rests below it.
      result.current.updatePrice("30");
    });

    expect(result.current.quote).toEqual({
      depositWad: 30n * WAD,
      direction: "bid",
      priceCents: 30,
      sizeWad: 100n * WAD,
    });
    expect(result.current.priceFieldError).toBeUndefined();
    expect(result.current.placeAction.disabled).toBe(false);
  });

  it("escrows outcome tokens for an ask", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectAction("sell");
      result.current.updatePrice("95");
    });

    expect(result.current.quote).toEqual({
      depositWad: 100n * WAD,
      direction: "ask",
      priceCents: 95,
      sizeWad: 100n * WAD,
    });
  });

  it("strips non-numeric characters from the price and size inputs", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("3a0.5");
      result.current.updateSize("12b.5!");
    });

    expect(result.current.priceInput).toBe("305");
    expect(result.current.sizeInput).toBe("12.5");
  });

  it("normalizes unknown segment values to the defaults", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectSide("mystery");
      result.current.selectAction("mystery");
    });

    expect(result.current.side).toBe("yes");
    expect(result.current.action).toBe("buy");
  });

  it("blocks a bid at or above the pool price with market-order advice", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("95");
    });

    expect(result.current.priceFieldError).toMatch(/use a market order/);
    expect(result.current.quote).toBeNull();
    expect(result.current.placeAction.disabled).toBe(true);
  });

  it("blocks an ask at or below the pool price", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectAction("sell");
      result.current.updatePrice("30");
    });

    expect(result.current.priceFieldError).toMatch(
      /sell limit at or below the current price/
    );
  });

  it("surfaces size validation through the size field error", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
      result.current.updateSize("");
    });

    expect(result.current.sizeFieldError).toBe("Enter a token amount.");
    expect(result.current.quote).toBeNull();
  });

  it("flags a bid deposit that exceeds the collateral balance", () => {
    vi.mocked(useVenueBalances).mockReturnValue({
      collateral: 10n * WAD,
      error: null,
      loading: false,
      no: 0n,
      yes: 0n,
    });
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    expect(result.current.sizeFieldError).toMatch(/your wallet has 10/);
    expect(result.current.placeAction.label).toBe("Insufficient pUSD");
  });

  it("flags an ask that exceeds the outcome token balance", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectAction("sell");
      result.current.updatePrice("95");
      result.current.updateSize("100");
    });

    expect(result.current.sizeFieldError).toMatch(/your wallet has 60/);
    expect(result.current.placeAction.label).toBe("Insufficient YES tokens");
  });

  it("checks the NO balance for an ask on the NO side", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectSide("no");
      result.current.selectAction("sell");
      // The NO pool fixture trades at 12c; a 30c ask rests above it.
      result.current.updatePrice("30");
      result.current.updateSize("100");
    });

    // The wallet holds only 40 NO tokens, so a 100-token ask is short.
    expect(result.current.sizeFieldError).toMatch(/your wallet has 40/);
    expect(result.current.placeAction.label).toBe("Insufficient NO tokens");
  });

  it("treats an unread balance as no blocking balance state", () => {
    vi.mocked(useVenueBalances).mockReturnValue({
      collateral: null,
      error: null,
      loading: false,
      no: null,
      yes: null,
    });
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    // With balances unknown the order is not flagged as insufficient.
    expect(result.current.placeAction.disabled).toBe(false);
    expect(result.current.sizeFieldError).toBeUndefined();
  });

  it("surfaces a broken pool key as the size field error", () => {
    vi.mocked(buildVenuePoolContext).mockImplementation(() => {
      throw new DisplayableError(
        "The venue pool key no longer matches the indexed pool."
      );
    });
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    expect(result.current.sizeFieldError).toMatch(/no longer matches/);
    expect(result.current.placeAction.disabled).toBe(true);
  });

  it("keeps the preview in the mock environment without an enabled action", () => {
    vi.mocked(resolveVenueTradingEnvironment).mockReturnValue({ kind: "mock" });
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    expect(result.current.quote).not.toBeNull();
    expect(result.current.placeAction.label).toBe("Preview only - no venue connected");
    expect(placeVenueLimitOrder).not.toHaveBeenCalled();
  });
});

describe("useLimitOrderState placement flow", () => {
  it("places the order and reports the resting confirmation", async () => {
    const onOrderPlaced = vi.fn();
    const { result } = renderTicket(venueMarket(), { onOrderPlaced });

    act(() => {
      result.current.updatePrice("30");
    });

    await waitFor(() => expect(result.current.placeAction.disabled).toBe(false));

    await act(async () => {
      result.current.placeAction.onClick?.();
    });

    expect(placeVenueLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "bid",
        poolDisplayPriceWad: 880_000_000_000_000_000n,
        priceCents: 30,
        side: "yes",
        sizeWad: 100n * WAD,
        venueConfig,
      })
    );
    expect(result.current.completedOrder).toEqual(orderReceipt());
    expect(result.current.isPlacing).toBe(false);
    expect(onOrderPlaced).toHaveBeenCalledTimes(1);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
  });

  it("maps placement failures through the limit error copy", async () => {
    vi.mocked(placeVenueLimitOrder).mockRejectedValue(
      new Error("execution reverted: InvalidOrderSide(false, -120, -60, 0)")
    );
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    await act(async () => {
      result.current.placeAction.onClick?.();
    });

    expect(result.current.submitError).toMatch(/fill immediately instead of resting/);
    expect(result.current.completedOrder).toBeNull();
  });

  it("clears stale confirmations when the form changes", async () => {
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    await act(async () => {
      result.current.placeAction.onClick?.();
    });
    expect(result.current.completedOrder).not.toBeNull();

    act(() => {
      result.current.updateSize("50");
    });

    expect(result.current.completedOrder).toBeNull();

    await act(async () => {
      result.current.placeAction.onClick?.();
    });
    expect(result.current.completedOrder).not.toBeNull();

    act(() => {
      result.current.selectSide("no");
    });

    expect(result.current.completedOrder).toBeNull();
  });

  it("blocks placement behind the wallet gate without a wallet client", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useWalletClient>);
    const { result } = renderTicket();

    act(() => {
      result.current.updatePrice("30");
    });

    expect(result.current.placeAction.label).toBe("Preparing trading client");
    expect(result.current.placeAction.disabled).toBe(true);
  });
});

function renderTicket(
  market: Market = venueMarket(),
  options: { onOrderPlaced?: () => void } = {}
) {
  return renderHook(() => useLimitOrderState(market, options));
}

function contractEnvironment(): Extract<VenueTradingEnvironment, { kind: "contract" }> {
  return {
    config: contractConfig,
    kind: "contract",
    venue: venueMarket().postgrad!.venue!,
    venueConfig,
  };
}

function poolContext(outcomeIsCurrency0: boolean): VenuePoolContext {
  return {
    outcomeIsCurrency0,
    outcomeTokenAddress: outcomeIsCurrency0
      ? "0x0000000000000000000000000000000000000003"
      : "0x0000000000000000000000000000000000000004",
    poolId: outcomeIsCurrency0 ? `0x${"11".repeat(32)}` : `0x${"22".repeat(32)}`,
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000003",
      currency1: "0x0000000000000000000000000000000000000002",
      fee: 3000,
      hooks: "0x00000000000000000000000000000000000000f1",
      tickSpacing: 60,
    },
  };
}

function orderReceipt(): VenueLimitOrderReceipt {
  return {
    amountIn: 30n * WAD,
    direction: "bid",
    orderId: 9,
    priceCents: 30,
    side: "yes",
    sizeWad: 100n * WAD,
    transactionHash: `0x${"cc".repeat(32)}`,
  };
}

function venueMarket(): Market {
  return marketFactory({
    chainId: 31337,
    id: "31337:7",
    postgrad: {
      adapterAddress: "0x00000000000000000000000000000000000000ab",
      completeSets: 100,
      finalizedAt: "2026-07-01T00:00:00.000Z",
      marketAddress: "0x00000000000000000000000000000000000000cd",
      refundedUsd: 0,
      retainedUsd: 100,
      venue: {
        boundedHookAddress: "0x00000000000000000000000000000000000000f1",
        live: true,
        noPool: {
          displayPriceWad: "120000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x0000000000000000000000000000000000000004",
          poolId: `0x${"22".repeat(32)}`,
          whitelisted: true,
        },
        orderManagerAddress: "0x00000000000000000000000000000000000000f2",
        poolManagerAddress: "0x00000000000000000000000000000000000000f0",
        yesPool: {
          displayPriceWad: "880000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x0000000000000000000000000000000000000003",
          poolId: `0x${"11".repeat(32)}`,
          whitelisted: true,
        },
      },
    },
    status: "graduated",
  });
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
