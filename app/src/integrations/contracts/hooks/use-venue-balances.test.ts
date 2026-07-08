import { renderHook, waitFor } from "@testing-library/react";
import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { useVenueBalances } from "./use-venue-balances";

const WAD = 10n ** 18n;
const WALLET = "0x1111111111111111111111111111111111111111";
const COLLATERAL = "0x0000000000000000000000000000000000000002" as const;
const YES_TOKEN = "0x0000000000000000000000000000000000000003" as const;
const NO_TOKEN = "0x0000000000000000000000000000000000000004" as const;

const disabledState = {
  collateral: null,
  error: null,
  loading: false,
  no: null,
  yes: null,
};

describe("useVenueBalances", () => {
  it.each([
    ["collateral address", { collateralAddress: null }],
    ["yes token", { yesTokenAddress: null }],
    ["no token", { noTokenAddress: null }],
    ["wallet address", { walletAddress: null }],
    ["public client", { publicClient: undefined }],
  ])("stays disabled without a %s", (_label, overrides) => {
    const { result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput(overrides),
    });

    expect(result.current).toEqual(disabledState);
  });

  it("reports loading while the reads are in flight", () => {
    const { client } = mockClient(new Promise(() => undefined));
    const { result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: client }),
    });

    expect(result.current.loading).toBe(true);
  });

  it("returns all three balances keyed by token address", async () => {
    const { client, reads } = mockClient();
    const { result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      collateral: 100n * WAD,
      error: null,
      loading: false,
      no: 3n * WAD,
      yes: 7n * WAD,
    });
    expect(reads).toHaveBeenCalledTimes(3);
    expect(reads).toHaveBeenCalledWith(
      expect.objectContaining({ address: COLLATERAL, args: [WALLET] })
    );
  });

  it("surfaces read failures through formatError", async () => {
    const { client } = mockClient(Promise.reject(new Error("rpc down")));
    const { result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      collateral: null,
      error: "formatted: rpc down",
      loading: false,
      no: null,
      yes: null,
    });
  });

  it("re-reads when the refresh key changes", async () => {
    const { client, reads } = mockClient();
    const { rerender, result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: client }),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender(balancesInput({ publicClient: client, refreshKey: 1 }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(reads).toHaveBeenCalledTimes(6);
  });

  it("drops in-flight results when the inputs change mid-read", async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const firstRead = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const { client: slowClient } = mockClient(firstRead);
    const { client: fastClient } = mockClient();
    const { rerender, result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: slowClient }),
    });

    rerender(
      balancesInput({
        publicClient: fastClient,
        walletAddress: "0x2222222222222222222222222222222222222222",
      })
    );
    resolveFirst?.(999n * WAD);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The stale 999 read for the first wallet must not surface.
    expect(result.current.collateral).toBe(100n * WAD);
  });

  it("drops in-flight failures when the inputs change mid-read", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const firstRead = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    firstRead.catch(() => undefined);
    const { client: failingClient } = mockClient(firstRead);
    const { client: fastClient } = mockClient();
    const { rerender, result } = renderHook((props) => useVenueBalances(props), {
      initialProps: balancesInput({ publicClient: failingClient }),
    });

    rerender(
      balancesInput({
        publicClient: fastClient,
        walletAddress: "0x2222222222222222222222222222222222222222",
      })
    );
    rejectFirst?.(new Error("stale rpc failure"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });
});

function balancesInput(
  overrides: Partial<Parameters<typeof useVenueBalances>[0]> = {}
): Parameters<typeof useVenueBalances>[0] {
  return {
    collateralAddress: COLLATERAL,
    formatError: (error: unknown) =>
      `formatted: ${error instanceof Error ? error.message : String(error)}`,
    noTokenAddress: NO_TOKEN,
    publicClient: mockClient().client,
    refreshKey: 0,
    walletAddress: WALLET,
    yesTokenAddress: YES_TOKEN,
    ...overrides,
  };
}

function mockClient(pending?: Promise<unknown>) {
  const reads = vi.fn(async ({ address }: { address: string }) => {
    if (pending) {
      return pending;
    }

    switch (address) {
      case COLLATERAL:
        return 100n * WAD;
      case YES_TOKEN:
        return 7n * WAD;
      case NO_TOKEN:
        return 3n * WAD;
      /* v8 ignore next 2 -- exhaustive switch over the three fixture tokens */
      default:
        throw new Error(`Unexpected read for ${address}`);
    }
  });

  return { client: { readContract: reads } as unknown as PublicClient, reads };
}
