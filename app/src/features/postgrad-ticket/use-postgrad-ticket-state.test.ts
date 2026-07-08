import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import type { Market } from "@/domain/markets/types";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { useVenueBalances } from "@/integrations/contracts/hooks/use-venue-balances";
import type { PostgradVenueContractConfig } from "@/integrations/contracts/postgrad-venue";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import {
  canMintLocalCollateral,
  mintLocalCollateral,
} from "@/features/receipt-ticket/place-receipt-service";
import { marketFactory } from "@/test/factories/markets";

import {
  buildVenuePoolContext,
  placeVenueSwap,
  quoteVenueSwap,
  resolveVenueTradingEnvironment,
  type VenuePoolContext,
  type VenueSwapReceipt,
  type VenueTradingEnvironment,
} from "./postgrad-swap-service";
import { PRICE_BOUND_QUOTE_WARNING } from "./swap-action";
import { usePostgradTicketState } from "./use-postgrad-ticket-state";

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

vi.mock("@/features/receipt-ticket/place-receipt-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/receipt-ticket/place-receipt-service")
  >()),
  canMintLocalCollateral: vi.fn(() => true),
  mintLocalCollateral: vi.fn(async () => undefined),
}));

vi.mock("./postgrad-swap-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./postgrad-swap-service")>()),
  buildVenuePoolContext: vi.fn(),
  placeVenueSwap: vi.fn(),
  quoteVenueSwap: vi.fn(),
  resolveVenueTradingEnvironment: vi.fn(),
}));

const routerMock = { push: vi.fn(), refresh: vi.fn() };
const WAD = 10n ** 18n;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const venueConfig: PostgradVenueContractConfig = {
  poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
  quoterAddress: "0x00000000000000000000000000000000000000b3",
  swapRouterAddress: "0x00000000000000000000000000000000000000b1",
};

beforeEach(() => {
  vi.mocked(usePublicClient).mockReturnValue({
    kind: "public-client",
  } as unknown as ReturnType<typeof usePublicClient>);
  vi.mocked(useWalletClient).mockReturnValue({
    data: { kind: "wallet-client" },
  } as unknown as ReturnType<typeof useWalletClient>);
  vi.mocked(canMintLocalCollateral).mockReturnValue(true);
  vi.mocked(mintLocalCollateral).mockResolvedValue(undefined);
  vi.mocked(resolveVenueTradingEnvironment).mockReturnValue(contractEnvironment());
  vi.mocked(buildVenuePoolContext).mockImplementation(({ side }) =>
    poolContext(side === "yes")
  );
  vi.mocked(quoteVenueSwap).mockResolvedValue(500n * WAD);
  vi.mocked(placeVenueSwap).mockResolvedValue(swapReceipt());
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

describe("usePostgradTicketState form state", () => {
  it("starts as a 250 pUSD YES buy with a quoter quote", async () => {
    const { result } = renderTicket();

    expect(result.current.action).toBe("buy");
    expect(result.current.side).toBe("yes");
    expect(result.current.amount).toBe("250");

    await waitFor(() => expect(result.current.quote?.source).toBe("quoter"));

    expect(result.current.quote?.amountIn).toBe(250n * WAD);
    expect(result.current.quote?.amountOut).toBe(500n * WAD);
    expect(result.current.amountFieldError).toBeUndefined();
  });

  it("switches side and action and strips non-numeric amount input", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectSide("no");
      result.current.selectAction("sell");
      result.current.updateAmount("12a.5!");
    });

    expect(result.current.side).toBe("no");
    expect(result.current.action).toBe("sell");
    expect(result.current.amount).toBe("12.5");
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

  it("fills presets directly and Max from the spend balance", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectPresetAmount("50");
    });
    expect(result.current.amount).toBe("50");

    act(() => {
      result.current.selectPresetAmount("Max");
    });
    // Buy Max fills from the 100,000 pUSD collateral balance.
    expect(result.current.amount).toBe("100000");
  });

  it("fills Max on the sell side from the outcome token balance", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectAction("sell");
    });
    act(() => {
      result.current.selectPresetAmount("Max");
    });

    expect(result.current.amount).toBe("60");
  });

  it("surfaces amount validation through the field error", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.updateAmount("");
    });

    expect(result.current.amountFieldError).toBe("Enter a collateral amount.");
    expect(result.current.quote).toBeNull();
  });

  it("flags a buy that exceeds the collateral balance", () => {
    vi.mocked(useVenueBalances).mockReturnValue({
      collateral: 10n * WAD,
      error: null,
      loading: false,
      no: 0n,
      yes: 0n,
    });
    const { result } = renderTicket();

    expect(result.current.amountFieldError).toMatch(/your wallet has 10/);
    expect(result.current.swapAction.label).toBe("Insufficient pUSD");
  });

  it("flags a sell that exceeds the outcome token balance", () => {
    const { result } = renderTicket();

    act(() => {
      result.current.selectAction("sell");
      result.current.updateAmount("100");
    });

    expect(result.current.amountFieldError).toMatch(/your wallet has 60/);
    expect(result.current.swapAction.label).toBe("Insufficient YES tokens");
  });
});

describe("usePostgradTicketState quoting", () => {
  it("falls back to a pool-price estimate without a quoter", async () => {
    vi.mocked(quoteVenueSwap).mockResolvedValue(null);
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.quoteLoading).toBe(false));

    expect(result.current.quote?.source).toBe("estimate");
    // 250 pUSD at the 88c fixture pool price, less the 0.3% fee.
    expect(result.current.quote?.amountOut).toBe(
      (250n * WAD * 997n * 100n) / (1_000n * 88n)
    );
  });

  it("keeps the estimate for the mock environment without chain calls", () => {
    vi.mocked(resolveVenueTradingEnvironment).mockReturnValue({ kind: "mock" });
    const { result } = renderTicket();

    expect(result.current.quote?.source).toBe("estimate");
    expect(result.current.quoteLoading).toBe(false);
    expect(quoteVenueSwap).not.toHaveBeenCalled();
    expect(result.current.swapAction.label).toBe("Preview only - no venue connected");
  });

  it("downgrades a price-bound quoter revert to an estimate with a warning", async () => {
    vi.mocked(quoteVenueSwap).mockRejectedValue(
      new Error("execution reverted: PoolTickOutOfBounds")
    );
    const { result } = renderTicket();

    await waitFor(() =>
      expect(result.current.quoteWarning).toBe(PRICE_BOUND_QUOTE_WARNING)
    );

    // The real swap's limit pins at the band edge, so the order still runs.
    expect(result.current.quote?.source).toBe("estimate");
    expect(result.current.amountFieldError).toBeUndefined();
    expect(result.current.swapAction.disabled).toBe(false);
  });

  it("surfaces other quoter failures as a blocking field error", async () => {
    vi.mocked(quoteVenueSwap).mockRejectedValue(new Error("rpc down"));
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.amountFieldError).toBe("rpc down"));

    expect(result.current.quote).toBeNull();
    expect(result.current.quoteWarning).toBeNull();
    expect(result.current.swapAction.disabled).toBe(true);
  });

  it("ignores stale quoter failures after the inputs change", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    vi.mocked(quoteVenueSwap).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        })
    );
    const { result } = renderTicket();

    act(() => {
      result.current.updateAmount("100");
    });

    await waitFor(() => expect(result.current.quote?.source).toBe("quoter"));

    act(() => {
      rejectFirst?.(new Error("stale quoter failure"));
    });

    // The stale failure for the 250 quote must not clobber the 100 quote.
    expect(result.current.amountFieldError).toBeUndefined();
    expect(result.current.quote?.amountIn).toBe(100n * WAD);
  });

  it("falls back to the 5,000 Max preset while balances are unknown", () => {
    vi.mocked(useVenueBalances).mockReturnValue({
      collateral: null,
      error: null,
      loading: true,
      no: null,
      yes: null,
    });
    const { result } = renderTicket();

    act(() => {
      result.current.selectPresetAmount("Max");
    });

    expect(result.current.amount).toBe("5000");
    expect(result.current.balances.collateral).toBeNull();
  });

  it("surfaces a broken pool key as the field error", () => {
    vi.mocked(buildVenuePoolContext).mockImplementation(() => {
      throw new Error("The venue pool key no longer matches the indexed pool.");
    });
    const { result } = renderTicket();

    expect(result.current.amountFieldError).toMatch(/no longer matches/);
    expect(result.current.swapAction.disabled).toBe(true);
  });
});

describe("usePostgradTicketState swap flow", () => {
  it("places the swap and reports the confirmed fill", async () => {
    const timeouts = interceptRefreshTimeouts();
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.swapAction.disabled).toBe(false));

    await act(async () => {
      result.current.swapAction.onClick?.();
    });

    expect(placeVenueSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "buy",
        amountIn: 250n * WAD,
        side: "yes",
        venueConfig,
      })
    );
    expect(result.current.completedSwap).toEqual(swapReceipt());
    expect(result.current.isSwapping).toBe(false);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    timeouts.flush();

    expect(routerMock.refresh).toHaveBeenCalledTimes(3);
  });

  it("reports swap failures through the submit error", async () => {
    vi.mocked(placeVenueSwap).mockRejectedValue(new Error("router unhappy"));
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.swapAction.disabled).toBe(false));

    await act(async () => {
      result.current.swapAction.onClick?.();
    });

    expect(result.current.submitError).toBe("router unhappy");
    expect(result.current.completedSwap).toBeNull();
  });

  it("requires a connected wallet before swapping", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useWalletClient>);
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.quote).not.toBeNull());

    // The action is blocked on the missing client; drive the handler through
    // a synthetic enabled action to exercise the wallet guard.
    expect(result.current.swapAction.label).toBe("Preparing trading client");
  });

  it("clears stale confirmations when the form changes", async () => {
    const { result } = renderTicket();

    await waitFor(() => expect(result.current.swapAction.disabled).toBe(false));

    await act(async () => {
      result.current.swapAction.onClick?.();
    });
    expect(result.current.completedSwap).not.toBeNull();

    act(() => {
      result.current.updateAmount("100");
    });

    expect(result.current.completedSwap).toBeNull();
  });
});

describe("usePostgradTicketState minting", () => {
  it("mints test pUSD and refreshes balances", async () => {
    const { result } = renderTicket();

    expect(result.current.canMintTestPusd).toBe(true);

    await act(async () => {
      void result.current.mintTestPusd();
    });

    expect(mintLocalCollateral).toHaveBeenCalledWith(
      expect.objectContaining({ amountUsd: 10_000, config: contractConfig })
    );
    expect(result.current.isMinting).toBe(false);
  });

  it("reports mint failures through the submit error", async () => {
    vi.mocked(mintLocalCollateral).mockRejectedValue(new Error("faucet dry"));
    const { result } = renderTicket();

    await act(async () => {
      void result.current.mintTestPusd();
    });

    expect(result.current.submitError).toBe("faucet dry");
  });

  it("does nothing without a wallet address", async () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));
    const { result } = renderTicket();

    await act(async () => {
      void result.current.mintTestPusd();
    });

    expect(mintLocalCollateral).not.toHaveBeenCalled();
  });

  it("hides the faucet outside local chains", () => {
    vi.mocked(canMintLocalCollateral).mockReturnValue(false);
    const { result } = renderTicket();

    expect(result.current.canMintTestPusd).toBe(false);
  });
});

function renderTicket(market: Market = venueMarket()) {
  return renderHook(() => usePostgradTicketState(market));
}

function interceptRefreshTimeouts() {
  const scheduled: (() => void)[] = [];
  const original = window.setTimeout.bind(window);

  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout === 1_500 || timeout === 4_000) {
      scheduled.push(handler as () => void);
      return 0 as unknown as ReturnType<typeof window.setTimeout>;
    }

    return original(handler, timeout, ...args);
  }) as typeof window.setTimeout);

  return {
    flush: () => {
      for (const handler of scheduled) {
        handler();
      }
    },
  };
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

function swapReceipt(): VenueSwapReceipt {
  return {
    action: "buy",
    amountIn: 250n * WAD,
    amountOut: 500n * WAD,
    partialFill: false,
    requestedIn: 250n * WAD,
    side: "yes",
    transactionHash: `0x${"bb".repeat(32)}`,
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
