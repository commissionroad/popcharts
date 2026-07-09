import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import type { PlacedPregradReceipt } from "@/domain/pregrad-trading/receipt-quote";
import { TEST_PUSD_MINTED_EVENT } from "@/features/dev-settings/test-pusd-events";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { useContractMarketStatus } from "@/integrations/contracts/hooks/use-contract-market-status";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { marketFactory } from "@/test/factories/markets";

import {
  placePregradReceipt,
  resolveTradingEnvironment,
  type TradingEnvironment,
} from "./place-receipt-service";
import { useReceiptTicketState } from "./use-receipt-ticket-state";

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(() => ({ kind: "public-client" })),
  useWalletClient: vi.fn(() => ({ data: { kind: "wallet-client" } })),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/integrations/contracts/hooks/use-contract-market-status", () => ({
  useContractMarketStatus: vi.fn(),
}));

vi.mock("./place-receipt-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./place-receipt-service")>()),
  placePregradReceipt: vi.fn(),
  resolveTradingEnvironment: vi.fn(),
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

const contractEnvironment: TradingEnvironment = {
  config: contractConfig,
  kind: "contract",
  marketId: 7n,
};

beforeEach(() => {
  vi.mocked(resolveTradingEnvironment).mockReturnValue(contractEnvironment);
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useContractMarketStatus).mockReturnValue({
    balance: 100_000n * WAD,
    error: null,
    loading: false,
    marketExists: true,
  });
  vi.mocked(placePregradReceipt).mockResolvedValue(placedReceipt());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useReceiptTicketState form state", () => {
  it("starts with a $250 YES quote", () => {
    const { result } = renderTicket();

    expect(result.current.amount).toBe("250");
    expect(result.current.side).toBe("yes");
    expect(result.current.quote).not.toBeNull();
    expect(result.current.amountFieldError).toBeUndefined();
    expect(result.current.walletConnected).toBe(true);
  });

  it("strips non-numeric characters from amount input", () => {
    const { result } = renderTicket();

    act(() => result.current.updateAmount("1a2b.5c"));

    expect(result.current.amount).toBe("12.5");
  });

  it("surfaces the amount validation error and drops the quote", () => {
    const { result } = renderTicket();

    act(() => result.current.updateAmount(""));

    expect(result.current.quote).toBeNull();
    expect(result.current.amountFieldError).toBe("Enter a collateral amount.");
  });

  it("hides amount errors once the receipt book is locked", () => {
    const { result } = renderTicket(marketFactory({ status: "graduating" }));

    act(() => result.current.updateAmount(""));

    expect(result.current.amountFieldError).toBeUndefined();
  });

  it("selects NO for the no side and defaults everything else to YES", () => {
    const { result } = renderTicket();

    act(() => result.current.selectSide("no"));
    expect(result.current.side).toBe("no");

    act(() => result.current.selectSide("anything"));
    expect(result.current.side).toBe("yes");
  });

  it("applies numeric presets directly", () => {
    const { result } = renderTicket();

    act(() => result.current.selectPresetAmount("50"));

    expect(result.current.amount).toBe("50");
  });

  it("falls back to the default Max preset when the balance is unknown", () => {
    vi.mocked(useContractMarketStatus).mockReturnValue({
      balance: null,
      error: null,
      loading: true,
      marketExists: null,
    });
    const { result } = renderTicket();

    act(() => result.current.selectPresetAmount("Max"));

    expect(result.current.balanceUsd).toBeNull();
    expect(result.current.amount).toBe("5000");
  });

  it("derives the Max preset from the discounted balance", () => {
    vi.mocked(useContractMarketStatus).mockReturnValue({
      balance: 1_015n * WAD,
      error: null,
      loading: false,
      marketExists: true,
    });
    const { result } = renderTicket();

    act(() => result.current.selectPresetAmount("Max"));

    // 1,015 pUSD discounted by the 150 bps slippage buffer.
    expect(result.current.amount).toBe("1000");
  });

  it("flags budgets whose max cost exceeds the balance", () => {
    vi.mocked(useContractMarketStatus).mockReturnValue({
      balance: 1n * WAD,
      error: null,
      loading: false,
      marketExists: true,
    });
    const { result } = renderTicket();

    expect(result.current.amountFieldError).toMatch(
      /Max cost is \$.*but your wallet has \$1\.00 pUSD\./
    );
    expect(result.current.receiptAction.label).toBe("Insufficient pUSD");
  });

  it("reports a market missing from the current contract", () => {
    vi.mocked(useContractMarketStatus).mockReturnValue({
      balance: 100n * WAD,
      error: null,
      loading: false,
      marketExists: false,
    });
    const { result } = renderTicket();

    expect(result.current.contractMarketMissing).toBe(true);
  });
});

describe("useReceiptTicketState placement", () => {
  it("places a receipt, stores it, and schedules data refreshes", async () => {
    // Capture only the hook's delayed-refresh timers; faking the whole timer
    // system breaks React's async act flushing.
    const original = window.setTimeout.bind(window);
    const delayedRefreshes: Array<() => void> = [];
    vi.spyOn(window, "setTimeout").mockImplementation(((
      callback: () => void,
      delay?: number
    ) => {
      if (delay === 1_500 || delay === 4_000) {
        delayedRefreshes.push(callback);

        return 0;
      }

      return original(callback, delay);
    }) as typeof window.setTimeout);
    const { result } = renderTicket();

    await act(async () => {
      result.current.receiptAction.onClick?.();
    });

    expect(result.current.placedReceipt?.id).toBe("31337:12");
    expect(result.current.submitError).toBeNull();
    expect(result.current.isPlacing).toBe(false);
    expect(
      window.localStorage.getItem("popcharts:placed-pregrad-receipts:v1")
    ).toContain("31337:12");
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);

    act(() => delayedRefreshes.forEach((refresh) => refresh()));

    // Once on success plus the two delayed refreshes at 1.5s and 4s.
    expect(delayedRefreshes).toHaveLength(2);
    expect(routerMock.refresh).toHaveBeenCalledTimes(3);
  });

  it("passes the wallet context and slippage to the placement service", async () => {
    const { result } = renderTicket();

    await act(async () => {
      result.current.receiptAction.onClick?.();
    });

    expect(placePregradReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          slippageBps: 150,
          wallet: expect.objectContaining({
            accountAddress: "0x1111111111111111111111111111111111111111",
            activeChainId: 31337,
          }),
        }),
        side: "yes",
      })
    );
  });

  it("omits the wallet context in the mock environment", async () => {
    vi.mocked(resolveTradingEnvironment).mockReturnValue({ kind: "mock" });
    const { result } = renderTicket();

    await act(async () => {
      result.current.receiptAction.onClick?.();
    });

    const call = vi.mocked(placePregradReceipt).mock.calls[0]?.[0];

    expect(call?.options?.wallet).toBeUndefined();
  });

  it("translates placement failures into ticket copy", async () => {
    vi.mocked(placePregradReceipt).mockRejectedValue(
      new Error("Execution reverted: 0x7ff80d38")
    );
    const { result } = renderTicket();

    await act(async () => {
      result.current.receiptAction.onClick?.();
    });

    await waitFor(() =>
      expect(result.current.submitError).toBe(
        "This market is not available on the current PregradManager. Create a new local market and try again."
      )
    );
    expect(result.current.placedReceipt).toBeNull();
    expect(result.current.isPlacing).toBe(false);
  });

  it("disables the action without a valid quote", () => {
    const { result } = renderTicket();

    act(() => result.current.updateAmount(""));

    expect(result.current.receiptAction.disabled).toBe(true);
    expect(result.current.receiptAction.onClick).toBeUndefined();
    expect(placePregradReceipt).not.toHaveBeenCalled();
  });

  it("exposes the in-flight placement step", async () => {
    let releasePlacement: (() => void) | undefined;
    vi.mocked(placePregradReceipt).mockImplementation(async ({ options }) => {
      options?.onStep?.("placing");

      await new Promise<void>((resolve) => {
        releasePlacement = resolve;
      });

      return placedReceipt();
    });
    const { result } = renderTicket();

    // Block body: returning the handler's promise would turn act async.
    act(() => {
      void result.current.receiptAction.onClick?.();
    });

    await waitFor(() => expect(result.current.placementStep).toBe("placing"));
    expect(result.current.isPlacing).toBe(true);
    expect(result.current.receiptAction.label).toBe("Placing receipt");

    await act(async () => {
      releasePlacement?.();
    });

    await waitFor(() => expect(result.current.isPlacing).toBe(false));
    expect(result.current.placementStep).toBeNull();
  });
});

describe("useReceiptTicketState balance refresh", () => {
  it("refreshes the contract status after the dev menu mints pUSD", () => {
    const { result } = renderTicket();

    expect(result.current.submitError).toBeNull();
    expect(vi.mocked(useContractMarketStatus).mock.calls.at(-1)?.[0]?.refreshKey).toBe(
      0
    );

    act(() => {
      window.dispatchEvent(new Event(TEST_PUSD_MINTED_EVENT));
    });

    expect(vi.mocked(useContractMarketStatus).mock.calls.at(-1)?.[0]?.refreshKey).toBe(
      1
    );
  });
});

function renderTicket(market: Market = contractMarket()) {
  return renderHook(() => useReceiptTicketState(market));
}

function contractMarket(): Market {
  return marketFactory({ chainId: 31337, id: "31337:7", status: "bootstrap" });
}

function placedReceipt(): PlacedPregradReceipt {
  return {
    averagePriceCents: 52,
    collateralUsd: 100,
    createdAt: "2026-07-06T12:00:00.000Z",
    id: "31337:12",
    marketId: "31337:7",
    marketQuestion: "Will the hook tests pass?",
    priceBand: { fromProbability: 50, toProbability: 54 },
    receiptId: "12",
    shares: 192,
    side: "yes",
    status: "waiting",
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
