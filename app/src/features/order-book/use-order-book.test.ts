import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ORDER_BOOK_FALLBACK_POLL_INTERVAL_MS,
  ORDER_BOOK_POLL_INTERVAL_MS,
  type OrderBookLookup,
  orderBookRequestPath,
  useOrderBook,
} from "./use-order-book";

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

// vi.useFakeTimers breaks React act flushing (see frontend-testing skill), so
// polling is driven by capturing the interval callback and invoking it.
let intervalHandlers: Array<() => void>;
let clearedIntervalIds: number[];

beforeEach(() => {
  liveMocks.connection = null;
  liveMocks.useLiveChannel.mockReset();
  intervalHandlers = [];
  clearedIntervalIds = [];
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler) => {
    intervalHandlers.push(handler as () => void);

    return intervalHandlers.length;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
    if (id !== undefined) {
      clearedIntervalIds.push(id);
    }
  }) as typeof window.clearInterval);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useOrderBook", () => {
  it("stays disabled without fetching for a null lookup", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(null));

    expect(result.current).toEqual({ book: null, error: null, loading: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(intervalHandlers).toHaveLength(0);
  });

  it("fetches the book through the proxy route and reports it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(bookPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(lookup()));

    expect(result.current.loading).toBe(true);
    await flushAsync();
    expect(result.current.book).toEqual(bookPayload());
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/indexer/orderbook?chainId=31337&marketId=0xabc",
      { cache: "no-store", headers: { accept: "application/json" } }
    );
    expect(window.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      ORDER_BOOK_POLL_INTERVAL_MS
    );
  });

  it("re-fetches on each poll tick while the tab is visible", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(bookPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(lookup()));
    await flushAsync();
    expect(result.current.book).not.toBeNull();

    await act(async () => {
      intervalHandlers[0]?.();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips poll ticks while the tab is hidden", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(bookPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useOrderBook(lookup()));
    await flushAsync();
    expect(result.current.book).not.toBeNull();

    withHiddenDocument(() => {
      intervalHandlers[0]?.();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a non-ok response as a generic error (no raw status detail)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 }))
    );

    const { result } = renderHook(() => useOrderBook(lookup()));

    await flushAsync();
    expect(result.current.error).toBe("Order book request failed.");
    expect(result.current.book).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("falls back to a generic message for thrown non-Error values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "offline";
      })
    );

    const { result } = renderHook(() => useOrderBook(lookup()));

    await flushAsync();
    expect(result.current.error).toBe("Order book request failed.");
  });

  it("keeps the last good book when a later poll fails", async () => {
    const fetchMock = vi
      .fn(async () => jsonResponse(bookPayload()))
      .mockImplementationOnce(async () => jsonResponse(bookPayload()))
      .mockImplementationOnce(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(lookup()));
    await flushAsync();
    expect(result.current.book).not.toBeNull();

    await act(async () => {
      intervalHandlers[0]?.();
    });

    expect(result.current.book).toEqual(bookPayload());
    expect(result.current.error).toBe("Order book request failed.");
  });

  it("clears the poll interval and ignores in-flight results after unmount", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useOrderBook(lookup()));
    unmount();
    await act(async () => {
      resolveFetch(jsonResponse(bookPayload()));
    });

    expect(clearedIntervalIds).toEqual([1]);
    expect(result.current.book).toBeNull();
  });

  it("subscribes to the market channel and refetches on a signal", async () => {
    liveMocks.connection = {};
    const fetchMock = vi.fn(async () => jsonResponse(bookPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(lookup()));
    await flushAsync();
    expect(result.current.book).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { channel, handler } = lastSubscription();
    expect(channel).toBe("market:31337:0xabc");

    // The signal is a nudge, never data: it drives the hook's own refetch.
    await act(async () => {
      handler();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("subscribes to no channel for a null lookup", () => {
    vi.stubGlobal("fetch", vi.fn());

    renderHook(() => useOrderBook(null));

    expect(lastSubscription().channel).toBeNull();
  });

  it("slows the poll to the fallback cadence when live updates are connected", async () => {
    liveMocks.connection = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(bookPayload()))
    );

    renderHook(() => useOrderBook(lookup()));
    await flushAsync();

    // The interval survives as a safety net, at the slow fallback cadence.
    expect(window.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      ORDER_BOOK_FALLBACK_POLL_INTERVAL_MS
    );
  });

  it("ignores a stale response that resolves after a newer refetch", async () => {
    liveMocks.connection = {};
    const staleBook = { chainId: 31337, marketId: "stale" };
    const freshBook = { chainId: 31337, marketId: "fresh" };
    let resolveFirst: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn(async () => jsonResponse(freshBook))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrderBook(lookup()));
    const { handler } = lastSubscription();

    // A live signal starts a second fetch while the first is still in flight;
    // the newer response commits first.
    await act(async () => {
      handler();
    });
    expect(result.current.book).toEqual(freshBook);

    // The slow original response must not overwrite the fresher book.
    await act(async () => {
      resolveFirst(jsonResponse(staleBook));
    });
    expect(result.current.book).toEqual(freshBook);
  });

  it("ignores a live signal after unmount", async () => {
    liveMocks.connection = {};
    const fetchMock = vi.fn(async () => jsonResponse(bookPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useOrderBook(lookup()));
    await flushAsync();
    const { handler } = lastSubscription();
    unmount();

    await act(async () => {
      handler();
    });

    // Cleanup nulled the loader, so the late signal fetches nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an in-flight failure after unmount", async () => {
    let rejectFetch: (reason: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          })
      )
    );

    const { result, unmount } = renderHook(() => useOrderBook(lookup()));
    unmount();
    await act(async () => {
      rejectFetch(new Error("aborted"));
    });

    expect(result.current.error).toBeNull();
  });
});

describe("orderBookRequestPath", () => {
  it("URL-encodes the market id", () => {
    expect(orderBookRequestPath({ chainId: 31337, marketId: "a b" })).toBe(
      "/api/indexer/orderbook?chainId=31337&marketId=a+b"
    );
  });
});

function bookPayload() {
  return { chainId: 31337, marketId: "0xabc" };
}

// waitFor polls through window.setInterval, which these tests stub; flushing
// the microtask queue inside act settles the mocked fetch chain instead.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function lookup(): OrderBookLookup {
  return { chainId: 31337, marketId: "0xabc" };
}

function withHiddenDocument(run: () => void) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });

  try {
    run();
  } finally {
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
}
