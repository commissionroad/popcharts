import type { VenueOrder } from "@popcharts/api-client/models";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import type { Market } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import type { PostgradVenueContractConfig } from "@/integrations/contracts/postgrad-venue";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { marketFactory } from "@/test/factories/markets";

import {
  cancelVenueLimitOrder,
  type VenueCancelOrderReceipt,
} from "./limit-order-service";
import {
  buildVenuePoolContext,
  resolveVenueTradingEnvironment,
  type VenuePoolContext,
  type VenueTradingEnvironment,
} from "./postgrad-swap-service";
import { useOpenOrdersPanelState } from "./use-open-orders-panel-state";
import { type OpenVenueOrdersState, useOpenVenueOrders } from "./use-open-venue-orders";

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

vi.mock("./limit-order-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./limit-order-service")>()),
  cancelVenueLimitOrder: vi.fn(),
}));

vi.mock("./postgrad-swap-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./postgrad-swap-service")>()),
  buildVenuePoolContext: vi.fn(),
  resolveVenueTradingEnvironment: vi.fn(),
}));

vi.mock("./use-open-venue-orders", () => ({
  useOpenVenueOrders: vi.fn(),
}));

const routerMock = { push: vi.fn(), refresh: vi.fn() };

const YES_POOL_ID: `0x${string}` = `0x${"11".repeat(32)}`;
const NO_POOL_ID: `0x${string}` = `0x${"22".repeat(32)}`;

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
  vi.mocked(cancelVenueLimitOrder).mockResolvedValue(cancelReceipt());
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useOpenVenueOrders).mockReturnValue(ordersState());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useOpenOrdersPanelState visibility", () => {
  it("shows for a connected wallet on a live venue", () => {
    const { result } = renderPanel();

    expect(result.current.visible).toBe(true);
    expect(useOpenVenueOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 31337,
        marketId: "7",
        owner: "0x1111111111111111111111111111111111111111",
      })
    );
  });

  it("hides on a fixture-backed venue", () => {
    vi.mocked(resolveVenueTradingEnvironment).mockReturnValue({ kind: "mock" });

    const { result } = renderPanel();

    expect(result.current.visible).toBe(false);
    expect(useOpenVenueOrders).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: null, marketId: null, owner: null })
    );
  });

  it("hides without a connected wallet", () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));

    const { result } = renderPanel();

    expect(result.current.visible).toBe(false);
  });

  it("hides when the market id cannot be parsed", () => {
    const { result } = renderPanel(venueMarket("not-a-market-id"));

    expect(result.current.visible).toBe(false);
  });

  it("passes the polled loading, error, and loaded flags through", () => {
    vi.mocked(useOpenVenueOrders).mockReturnValue(
      ordersState({
        error: "Could not load your open orders.",
        loading: true,
        orders: null,
      })
    );

    const { result } = renderPanel();

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe("Could not load your open orders.");
    expect(result.current.ordersLoaded).toBe(false);
  });
});

describe("useOpenOrdersPanelState rows", () => {
  it("maps a resting order into a display row", () => {
    const { result } = renderPanel();

    expect(result.current.rows).toEqual([
      expect.objectContaining({
        cancelling: false,
        filling: false,
        key: `${YES_POOL_ID}:9`,
        priceCents: 30,
        remainingSize: 100,
        sideLabel: "YES",
        size: 100,
      }),
    ]);
  });

  it("marks a partially filled order as filling", () => {
    vi.mocked(useOpenVenueOrders).mockReturnValue(
      ordersState({ orders: [openOrder({ remainingSizeWad: (60n * WAD).toString() })] })
    );

    const { result } = renderPanel();

    expect(result.current.rows[0]!.filling).toBe(true);
    expect(result.current.rows[0]!.remainingSize).toBe(60);
  });

  it("marks an order the pool price has crossed as filling", () => {
    // A 30c bid with the pool at 20c (below the bid) is crossed.
    vi.mocked(useOpenVenueOrders).mockReturnValue(
      ordersState({ poolPricesWad: { [YES_POOL_ID]: (2n * WAD) / 10n + "" } })
    );

    const { result } = renderPanel();

    expect(result.current.rows[0]!.filling).toBe(true);
  });

  it("falls back to the indexed venue price when the poll has none", () => {
    // No polled price for the pool; the venue payload prices YES at 88c, which
    // is above the 30c bid, so it is not crossed.
    vi.mocked(useOpenVenueOrders).mockReturnValue(ordersState({ poolPricesWad: {} }));

    const { result } = renderPanel();

    expect(result.current.rows[0]!.filling).toBe(false);
  });

  it("labels an ask on the NO pool and leaves the price unknown when no source has it", () => {
    vi.mocked(useOpenVenueOrders).mockReturnValue(
      ordersState({
        orders: [
          openOrder({
            direction: "ask",
            poolId: NO_POOL_ID,
            priceWad: (12n * WAD) / 100n + "",
            side: "no",
          }),
        ],
        poolPricesWad: {},
      })
    );
    // Blank the NO pool's indexed display price on the live venue payload the
    // hook reads, so neither the poll nor the venue knows the pool's price.
    const environment = contractEnvironment();
    environment.venue.noPool.displayPriceWad = "";
    vi.mocked(resolveVenueTradingEnvironment).mockReturnValue(environment);

    const { result } = renderPanel();

    expect(result.current.rows[0]!.sideLabel).toBe("NO");
    // No price source, no partial fill: filling stays false.
    expect(result.current.rows[0]!.filling).toBe(false);
  });
});

describe("useOpenOrdersPanelState cancel flow", () => {
  it("cancels an order and refreshes both the list and the route", async () => {
    const { result } = renderPanel();
    const row = result.current.rows[0]!;

    await act(async () => {
      await result.current.cancelOrder(row);
    });

    expect(cancelVenueLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 9,
        venue: expect.anything(),
        venueConfig,
      })
    );
    expect(ordersStateValue.refresh).toHaveBeenCalledTimes(1);
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.cancelError).toBeNull();
  });

  it("marks the row as cancelling and surfaces the step while in flight", async () => {
    let release: (() => void) | undefined;
    vi.mocked(cancelVenueLimitOrder).mockImplementation(({ onStep }) => {
      onStep?.("cancelling");

      return new Promise<VenueCancelOrderReceipt>((resolve) => {
        release = () => resolve(cancelReceipt());
      });
    });
    const { result } = renderPanel();

    act(() => {
      void result.current.cancelOrder(result.current.rows[0]!);
    });

    expect(result.current.rows[0]!.cancelling).toBe(true);
    expect(result.current.cancelStep).toBe("cancelling");

    await act(async () => {
      release?.();
    });

    expect(result.current.rows[0]!.cancelling).toBe(false);
    expect(result.current.cancelStep).toBeNull();
  });

  it("maps a cancel revert through the limit error copy", async () => {
    vi.mocked(cancelVenueLimitOrder).mockRejectedValue(
      new Error("execution reverted: OrderNotFound(0x00, 9)")
    );
    const { result } = renderPanel();

    await act(async () => {
      await result.current.cancelOrder(result.current.rows[0]!);
    });

    expect(result.current.cancelError).toBe(
      "This order has already been filled or cancelled."
    );
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("blocks the cancel when the trading client is not ready", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useWalletClient>);
    const { result } = renderPanel();

    await act(async () => {
      await result.current.cancelOrder(result.current.rows[0]!);
    });

    expect(cancelVenueLimitOrder).not.toHaveBeenCalled();
    expect(result.current.cancelError).toBe(
      "Connect a wallet before cancelling orders."
    );
  });
});

let ordersStateValue: OpenVenueOrdersState;

function renderPanel(market: Market = venueMarket()) {
  return renderHook(() => useOpenOrdersPanelState(market, { refreshKey: 0 }));
}

function ordersState(
  overrides: Partial<OpenVenueOrdersState> = {}
): OpenVenueOrdersState {
  ordersStateValue = {
    error: null,
    loading: false,
    orders: [openOrder()],
    poolPricesWad: { [YES_POOL_ID]: (88n * WAD) / 100n + "" },
    refresh: vi.fn(),
    ...overrides,
  };

  return ordersStateValue;
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
    poolId: outcomeIsCurrency0 ? YES_POOL_ID : NO_POOL_ID,
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000003",
      currency1: "0x0000000000000000000000000000000000000002",
      fee: 3000,
      hooks: "0x00000000000000000000000000000000000000f1",
      tickSpacing: 60,
    },
  };
}

function cancelReceipt(): VenueCancelOrderReceipt {
  return {
    amount0: 30n * WAD,
    amount1: 0n,
    orderId: 9,
    transactionHash: `0x${"cc".repeat(32)}`,
  };
}

function openOrder(overrides: Partial<VenueOrder> = {}): VenueOrder {
  return {
    amountIn: "30000000000000000000",
    createdBlockTimestamp: "2026-07-08T00:00:00.000Z",
    createdTransactionHash: `0x${"cc".repeat(32)}`,
    direction: "bid",
    orderId: 9,
    owner: "0x1111111111111111111111111111111111111111",
    poolId: YES_POOL_ID,
    priceWad: (30n * WAD) / 100n + "",
    remainingSizeWad: (100n * WAD).toString(),
    side: "yes",
    sizeWad: (100n * WAD).toString(),
    status: "open",
    tickLower: -12120,
    tickUpper: -12060,
    ...overrides,
  };
}

function venueMarket(id = "31337:7"): Market {
  return marketFactory({
    chainId: 31337,
    id,
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
          poolId: NO_POOL_ID,
          whitelisted: true,
        },
        orderManagerAddress: "0x00000000000000000000000000000000000000f2",
        poolManagerAddress: "0x00000000000000000000000000000000000000f0",
        yesPool: {
          displayPriceWad: "880000000000000000",
          initialized: true,
          outcomeTokenAddress: "0x0000000000000000000000000000000000000003",
          poolId: YES_POOL_ID,
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
