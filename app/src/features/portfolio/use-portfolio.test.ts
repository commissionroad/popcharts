import type { Portfolio } from "@popcharts/api-client/models";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PORTFOLIO_POLL_INTERVAL_MS, usePortfolio } from "./use-portfolio";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  stubFetch(emptyPortfolio());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("usePortfolio", () => {
  it("stays disabled until an owner is available", () => {
    const { result } = renderHook(() => usePortfolio({ chainId: 31337, owner: null }));

    expect(result.current.portfolio).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stays disabled without a chain id", () => {
    const { result } = renderHook(() => usePortfolio({ chainId: null, owner: OWNER }));

    expect(result.current.portfolio).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the wallet's portfolio through the same-origin proxy", async () => {
    const { result } = renderHook(() => usePortfolioArgs());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.portfolio).not.toBeNull());

    expect(result.current.portfolio).toEqual(emptyPortfolio());
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    const requested = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(requested).toEqual([`/api/indexer/portfolio?chainId=31337&owner=${OWNER}`]);
  });

  it("re-reads when refresh() is called and keeps the previous payload", async () => {
    const { result } = renderHook(() => usePortfolioArgs());

    await waitFor(() => expect(result.current.portfolio).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(2));
    expect(result.current.portfolio).toEqual(emptyPortfolio());
  });

  it("polls again after the interval and skips reads while hidden", async () => {
    const timers = interceptPollTimeouts();
    const { result } = renderHook(() => usePortfolioArgs());

    await waitFor(() => expect(result.current.portfolio).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(timers.scheduled()).toBe(1);

    // Hidden tab: the tick reschedules without fetching.
    setVisibility("hidden");
    act(() => {
      timers.fire();
    });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(timers.scheduled()).toBe(1);

    // Visible again: the next tick re-reads.
    setVisibility("visible");
    act(() => {
      timers.fire();
    });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(2));
  });

  it("collapses HTTP failures to curated copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    const { result } = renderHook(() => usePortfolioArgs());

    await waitFor(() =>
      expect(result.current.error).toBe("Could not load your portfolio.")
    );
    expect(result.current.portfolio).toBeNull();
  });

  it("collapses unreadable failures to curated copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "socket vanished";
      })
    );

    const { result } = renderHook(() => usePortfolioArgs());

    await waitFor(() =>
      expect(result.current.error).toBe("Could not load your portfolio.")
    );
  });

  it("tears down cleanly when unmounted before the first read settles", () => {
    const { unmount } = renderHook(() => usePortfolioArgs());

    expect(() => unmount()).not.toThrow();
  });

  it("ignores a failure that settles after unmount", async () => {
    let rejectRead!: (error: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectRead = reject;
          })
      )
    );

    const { unmount } = renderHook(() => usePortfolioArgs());

    unmount();
    rejectRead(new Error("late failure"));

    // Flush the rejection through the catch handler; the unmounted hook must
    // swallow it without a state update.
    await act(async () => {
      await Promise.resolve();
    });
  });
});

function usePortfolioArgs() {
  return usePortfolio({ chainId: 31337, owner: OWNER });
}

function stubFetch(portfolio: Portfolio) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = String(input);

      if (url.includes("/api/indexer/portfolio")) {
        return Response.json(portfolio);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
}

function interceptPollTimeouts() {
  const scheduled: (() => void)[] = [];
  const original = window.setTimeout.bind(window);

  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout === PORTFOLIO_POLL_INTERVAL_MS) {
      scheduled.push(handler as () => void);
      return scheduled.length as unknown as ReturnType<typeof window.setTimeout>;
    }

    return original(handler, timeout, ...args);
  }) as typeof window.setTimeout);

  return {
    fire: () => {
      scheduled.shift()?.();
    },
    scheduled: () => scheduled.length,
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function emptyPortfolio(): Portfolio {
  return {
    chainId: 31337,
    openOrders: [],
    owner: OWNER,
    positions: [],
    receipts: [],
    redemptions: [],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: "0",
      openOrderCount: 0,
      openReceiptCount: 0,
      positionCount: 0,
      totalPositionValueWad: "0",
    },
  };
}
