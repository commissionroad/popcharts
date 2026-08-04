import { renderHook, waitFor } from "@testing-library/react";
import type { PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient } from "wagmi";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import type { MarketDisputeSnapshot } from "../market-dispute-state";
import { readMarketDisputeState } from "../market-dispute-state";
import { useMarketDisputeState } from "./use-market-dispute-state";

vi.mock("wagmi", () => ({ usePublicClient: vi.fn() }));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

vi.mock("../market-dispute-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../market-dispute-state")>()),
  readMarketDisputeState: vi.fn(),
}));

const MARKET = "0x2222222222222222222222222222222222222222" as const;
const OTHER_MARKET = "0x5555555555555555555555555555555555555555" as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewCreditVaultAddress: null,
  rpcUrl: "http://127.0.0.1:8545",
};

const publicClient = {} as unknown as PublicClient;
const snapshot: MarketDisputeSnapshot = {
  bond: 100n * 10n ** 18n,
  bondHeld: 0n,
  collateralDecimals: 18,
  deadline: 1_700_000_000,
  disputer: null,
  phase: "pending",
  proposedSide: "yes",
  resolver: "0x4444444444444444444444444444444444444444",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(usePublicClient).mockReturnValue(
    publicClient as ReturnType<typeof usePublicClient>
  );
  vi.mocked(readMarketDisputeState).mockResolvedValue(snapshot);
});

describe("useMarketDisputeState", () => {
  it.each([
    ["no market address", () => {}, null],
    [
      "no contract config",
      () => vi.mocked(getPopChartsContractConfig).mockReturnValue(null),
      MARKET,
    ],
    [
      "no public client",
      () =>
        vi
          .mocked(usePublicClient)
          .mockReturnValue(undefined as unknown as ReturnType<typeof usePublicClient>),
      MARKET,
    ],
  ])("stays idle with %s", (_label, arrange, marketAddress) => {
    arrange();

    const { result } = renderHook(() => useMarketDisputeState({ marketAddress }));

    expect(result.current).toEqual({ error: null, loading: false, snapshot: null });
    expect(readMarketDisputeState).not.toHaveBeenCalled();
  });

  it("reads the market's dispute state and reports it once resolved", async () => {
    const { result } = renderHook(() =>
      useMarketDisputeState({ marketAddress: MARKET })
    );

    expect(result.current).toEqual({ error: null, loading: true, snapshot: null });

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.loading).toBe(false);
    expect(readMarketDisputeState).toHaveBeenCalledWith({
      marketAddress: MARKET,
      publicClient,
    });
  });

  it("re-reads when refreshKey changes", async () => {
    const { rerender, result } = renderHook(
      ({ refreshKey }) => useMarketDisputeState({ marketAddress: MARKET, refreshKey }),
      { initialProps: { refreshKey: 0 } }
    );

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    rerender({ refreshKey: 1 });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(readMarketDisputeState).toHaveBeenCalledTimes(2);
  });

  it("discards a read that resolves after the market changed", async () => {
    const settled: MarketDisputeSnapshot = { ...snapshot, phase: "disputed" };
    let releaseFirst = () => {};
    vi.mocked(readMarketDisputeState).mockImplementationOnce(
      async () =>
        await new Promise<MarketDisputeSnapshot>((resolve) => {
          releaseFirst = () => resolve(snapshot);
        })
    );
    vi.mocked(readMarketDisputeState).mockResolvedValueOnce(settled);

    const { rerender, result } = renderHook(
      ({ marketAddress }) => useMarketDisputeState({ marketAddress }),
      { initialProps: { marketAddress: MARKET as `0x${string}` } }
    );

    rerender({ marketAddress: OTHER_MARKET });
    releaseFirst();

    await waitFor(() => expect(result.current.snapshot).toEqual(settled));
  });

  it("discards a read that fails after the market changed", async () => {
    let failFirst = () => {};
    vi.mocked(readMarketDisputeState).mockImplementationOnce(
      async () =>
        await new Promise<MarketDisputeSnapshot>((_resolve, reject) => {
          failFirst = () => reject(new Error("rpc exploded"));
        })
    );

    const { rerender, result } = renderHook(
      ({ marketAddress }) => useMarketDisputeState({ marketAddress }),
      { initialProps: { marketAddress: MARKET as `0x${string}` } }
    );

    rerender({ marketAddress: OTHER_MARKET });
    failFirst();

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(result.current.error).toBeNull();
  });

  it("surfaces a read failure as user-facing copy", async () => {
    vi.mocked(readMarketDisputeState).mockRejectedValue(new Error("rpc exploded"));

    const { result } = renderHook(() =>
      useMarketDisputeState({ marketAddress: MARKET })
    );

    await waitFor(() =>
      expect(result.current.error).toBe(
        "Could not read this market's resolution status."
      )
    );
    expect(result.current.snapshot).toBeNull();
  });
});
