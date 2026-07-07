import { renderHook, waitFor } from "@testing-library/react";
import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "../config";
import { useContractMarketStatus } from "./use-contract-market-status";

const WAD = 10n ** 18n;
const WALLET = "0x1111111111111111111111111111111111111111";

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

describe("useContractMarketStatus", () => {
  it.each([
    ["config", { config: null }],
    ["market id", { marketId: null }],
    ["wallet address", { walletAddress: null }],
    ["public client", { publicClient: undefined }],
  ])("stays disabled without a %s", (_label, overrides) => {
    const { result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput(overrides),
    });

    expect(result.current).toEqual({
      balance: null,
      error: null,
      loading: false,
      marketExists: null,
    });
  });

  it("reports loading while the reads are in flight", () => {
    const { client } = mockClient(new Promise(() => undefined));
    const { result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: client }),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBeNull();
  });

  it("returns the balance and market flag once both reads land", async () => {
    const { client, reads } = mockClient();
    const { result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      balance: 5n * WAD,
      error: null,
      loading: false,
      marketExists: true,
    });
    expect(reads).toHaveBeenCalledTimes(2);
    expect(reads).toHaveBeenCalledWith(
      expect.objectContaining({ args: [WALLET], functionName: "balanceOf" })
    );
    expect(reads).toHaveBeenCalledWith(
      expect.objectContaining({ args: [7n], functionName: "marketExists" })
    );
  });

  it("surfaces read failures through formatError", async () => {
    const { client } = mockClient(Promise.reject(new Error("rpc down")));
    const { result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      balance: null,
      error: "formatted: rpc down",
      loading: false,
      marketExists: null,
    });
  });

  it("re-reads when the refresh key changes", async () => {
    const { client, reads } = mockClient();
    const { rerender, result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender(statusInput({ publicClient: client, refreshKey: 1 }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(reads).toHaveBeenCalledTimes(4);
  });

  it("drops in-flight failures when the inputs change mid-read", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const firstRead = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    firstRead.catch(() => undefined);
    const { client: failingClient } = mockClient(firstRead);
    const { client: fastClient } = mockClient();
    const { rerender, result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: failingClient }),
    });

    rerender(statusInput({ marketId: 8n, publicClient: fastClient }));
    rejectFirst?.(new Error("stale rpc failure"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The stale failure for market 7 must not surface on market 8's status.
    expect(result.current.error).toBeNull();
    expect(result.current.marketExists).toBe(true);
  });

  it("drops in-flight results when the inputs change mid-read", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const firstRead = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const { client: slowClient } = mockClient(firstRead);
    const { client: fastClient } = mockClient();
    const { rerender, result } = renderHook((props) => useContractMarketStatus(props), {
      initialProps: statusInput({ publicClient: slowClient }),
    });

    rerender(statusInput({ marketId: 8n, publicClient: fastClient }));
    resolveFirst?.(0n);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The stale read for market 7 must not leak into market 8's status.
    expect(result.current.marketExists).toBe(true);
    expect(result.current.balance).toBe(5n * WAD);
  });
});

function statusInput(
  overrides: Partial<Parameters<typeof useContractMarketStatus>[0]> = {}
): Parameters<typeof useContractMarketStatus>[0] {
  return {
    config: contractConfig,
    formatError: (error) =>
      `formatted: ${error instanceof Error ? error.message : "unknown"}`,
    marketId: 7n,
    publicClient: undefined,
    refreshKey: 0,
    walletAddress: WALLET,
    ...overrides,
  };
}

function mockClient(readResult?: Promise<unknown>) {
  const reads = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (readResult) {
      return readResult;
    }

    return functionName === "balanceOf" ? 5n * WAD : true;
  });

  return { client: { readContract: reads } as unknown as PublicClient, reads };
}
