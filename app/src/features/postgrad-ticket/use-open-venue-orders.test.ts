import type { VenueOrder } from "@popcharts/api-client/models";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_ORDERS_FALLBACK_POLL_INTERVAL_MS,
  OPEN_ORDERS_POLL_INTERVAL_MS,
  useOpenVenueOrders,
} from "./use-open-venue-orders";

const OWNER = "0x1111111111111111111111111111111111111111";
const YES_POOL_ID = `0x${"11".repeat(32)}`;

const liveMocks = vi.hoisted(() => ({
  connection: null as Record<string, never> | null,
  useLiveChannel: vi.fn(),
}));

vi.mock("@/integrations/live-updates/live-provider", () => ({
  useLiveConnection: () => liveMocks.connection,
}));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: liveMocks.useLiveChannel,
}));

/** The (channel, handler) the hook passed to useLiveChannel this render. */
function lastSubscription() {
  const call = liveMocks.useLiveChannel.mock.calls.at(-1);
  if (!call) {
    throw new Error("useLiveChannel was never called");
  }
  return { channel: call[0] as string | null, handler: call[1] as () => void };
}

beforeEach(() => {
  liveMocks.connection = null;
  stubFetch({
    book: {
      chainId: 31337,
      marketId: "7",
      yes: {
        asks: [],
        bids: [],
        marketPriceWad: "880000000000000000",
        outcomeTokenAddress: "0xabc",
        poolId: YES_POOL_ID,
        side: "yes",
      },
    },
    orders: [openOrder()],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useOpenVenueOrders", () => {
  it("stays disabled until every input is available", () => {
    const { result } = renderHook(() =>
      useOpenVenueOrders({ chainId: 31337, marketId: "7", owner: null, refreshKey: 0 })
    );

    expect(result.current.orders).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the owner's orders and the pool prices", async () => {
    const { result } = renderHook(() => useOpenOrdersArgs());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.orders).not.toBeNull());

    expect(result.current.orders).toEqual([openOrder()]);
    expect(result.current.poolPricesWad).toEqual({
      [YES_POOL_ID]: "880000000000000000",
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    const requested = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(requested).toEqual([
      `/api/indexer/venue-orders?chainId=31337&marketId=7&owner=${OWNER}`,
      "/api/indexer/orderbook?chainId=31337&marketId=7",
    ]);
  });

  it("re-reads when refresh() is called", async () => {
    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() => expect(result.current.orders).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(4));
    // The previous read stays on screen while the re-read is in flight.
    expect(result.current.orders).toEqual([openOrder()]);
  });

  it("re-reads when the external refresh key bumps", async () => {
    const { rerender, result } = renderHook(
      ({ refreshKey }: { refreshKey: number }) =>
        useOpenVenueOrders({
          chainId: 31337,
          marketId: "7",
          owner: OWNER,
          refreshKey,
        }),
      { initialProps: { refreshKey: 0 } }
    );

    await waitFor(() => expect(result.current.orders).not.toBeNull());

    rerender({ refreshKey: 1 });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(4));
  });

  it("polls again after the interval and skips reads while hidden", async () => {
    const timers = interceptPollTimeouts();
    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() => expect(result.current.orders).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(timers.scheduled()).toBe(1);

    // Hidden tab: the tick reschedules without fetching.
    setVisibility("hidden");
    act(() => {
      timers.fire();
    });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(timers.scheduled()).toBe(1);

    // Visible again: the next tick re-reads.
    setVisibility("visible");
    act(() => {
      timers.fire();
    });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(4));
  });

  it("surfaces HTTP failures as generic copy (no raw status detail)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() =>
      expect(result.current.error).toBe("Could not load your open orders.")
    );
    expect(result.current.orders).toBeNull();
  });

  it("falls back to generic copy for unreadable failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "socket vanished";
      })
    );

    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() =>
      expect(result.current.error).toBe("Could not load your open orders.")
    );
  });

  it("tolerates a book without pool prices", async () => {
    stubFetch({ book: { chainId: 31337, marketId: "7" }, orders: [] });

    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() => expect(result.current.orders).toEqual([]));
    expect(result.current.poolPricesWad).toEqual({});
  });

  it("tears down cleanly when unmounted before the first read settles", () => {
    const { unmount } = renderHook(() => useOpenOrdersArgs());

    // Unmount while the initial fetch is still pending: no poll has been
    // scheduled yet, so cleanup runs without a timer to clear.
    expect(() => unmount()).not.toThrow();
  });

  it("subscribes to the market channel and re-reads on a signal", async () => {
    liveMocks.connection = {};
    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() => expect(result.current.orders).not.toBeNull());
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);

    // The market channel, not the owner's: the panel's data (open orders plus
    // the pool prices it crosses them against) moves on any order or swap on
    // this market, and a redundant re-read from someone else's order is a
    // harmless nudge.
    const { channel, handler } = lastSubscription();
    expect(channel).toBe("market:31337:7");

    act(() => {
      handler();
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(4));
  });

  it("subscribes to no channel while the market is unknown", () => {
    renderHook(() =>
      useOpenVenueOrders({
        chainId: 31337,
        marketId: null,
        owner: OWNER,
        refreshKey: 0,
      })
    );

    expect(lastSubscription().channel).toBeNull();
  });

  it("slows the poll to the fallback cadence when live updates are connected", async () => {
    liveMocks.connection = {};
    const timers = interceptPollTimeouts(OPEN_ORDERS_FALLBACK_POLL_INTERVAL_MS);
    const { result } = renderHook(() => useOpenOrdersArgs());

    await waitFor(() => expect(result.current.orders).not.toBeNull());

    // The schedule survives as a safety net, at the slow fallback cadence.
    expect(timers.scheduled()).toBe(1);
  });
});

function useOpenOrdersArgs() {
  return useOpenVenueOrders({
    chainId: 31337,
    marketId: "7",
    owner: OWNER,
    refreshKey: 0,
  });
}

function stubFetch({ book, orders }: { book: unknown; orders: VenueOrder[] }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const url = String(input);

      if (url.includes("/venue-orders")) {
        return Response.json(orders);
      }

      if (url.includes("/orderbook")) {
        return Response.json(book);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
}

function interceptPollTimeouts(intervalMs = OPEN_ORDERS_POLL_INTERVAL_MS) {
  const scheduled: (() => void)[] = [];
  const original = window.setTimeout.bind(window);

  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    if (timeout === intervalMs) {
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

function openOrder(): VenueOrder {
  return {
    amountIn: "30000000000000000000",
    createdBlockTimestamp: "2026-07-08T00:00:00.000Z",
    createdTransactionHash: `0x${"cc".repeat(32)}`,
    direction: "bid",
    orderId: 9,
    owner: OWNER,
    poolId: YES_POOL_ID,
    priceWad: "300000000000000000",
    remainingSizeWad: "100000000000000000000",
    side: "yes",
    sizeWad: "100000000000000000000",
    status: "open",
    tickLower: -12120,
    tickUpper: -12060,
  };
}
