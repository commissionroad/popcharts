"use client";

import type { MarketOrderBook } from "@popcharts/api-client/models";
import { marketChannel } from "@popcharts/live-channels";
import { useEffect, useRef, useState } from "react";

import { useLiveConnection } from "@/integrations/live-updates/live-provider";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { presentError } from "@/lib/error-handling";

/** Poll cadence when no live transport is configured — the whole update path. */
export const ORDER_BOOK_POLL_INTERVAL_MS = 5_000;
/**
 * Poll cadence when live signals drive refetches (repo ADR 0021): a safety
 * net for a missed signal or a down SSE stream, not the update path.
 */
export const ORDER_BOOK_FALLBACK_POLL_INTERVAL_MS = 60_000;

export type OrderBookLookup = {
  chainId: number;
  marketId: string;
};

export type OrderBookState = {
  /** The last successfully fetched book; kept through later poll failures. */
  book: MarketOrderBook | null;
  error: string | null;
  /** True only while the first fetch for the current market is in flight. */
  loading: boolean;
};

/**
 * Fetches a graduated market's venue order book through the app's indexer
 * proxy route and keeps it fresh. With the live transport configured (repo
 * ADR 0021) the market's channel nudges a refetch whenever a maker order or a
 * taker swap touches the market, and the poll drops to a slow safety net;
 * without it, the original five-second poll is the whole update path. A null
 * lookup (fixture-backed market) disables fetching entirely. Refetch failures
 * keep the last good book and surface the error alongside it.
 */
export function useOrderBook(lookup: OrderBookLookup | null): OrderBookState {
  const [state, setState] = useState<OrderBookState>({
    book: null,
    error: null,
    loading: lookup !== null,
  });
  const chainId = lookup?.chainId;
  const marketId = lookup?.marketId;
  const live = useLiveConnection() !== null;
  const pollIntervalMs = live
    ? ORDER_BOOK_FALLBACK_POLL_INTERVAL_MS
    : ORDER_BOOK_POLL_INTERVAL_MS;
  // Lets a live signal reuse the effect's loader without re-running the
  // effect (which would reset the book to its loading state); null while no
  // fetch effect is active, so a stray signal has nothing stale to call.
  const loadRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (chainId === undefined || marketId === undefined) {
      return;
    }

    let isActive = true;
    // A live signal can start a fetch while an earlier one is still in
    // flight; only the newest request may commit, so a slow stale response
    // cannot overwrite a fresher book.
    let latestRequest = 0;
    setState({ book: null, error: null, loading: true });

    const load = async () => {
      const requestId = ++latestRequest;

      try {
        const book = await fetchOrderBook(chainId, marketId);

        if (isActive && requestId === latestRequest) {
          setState({ book, error: null, loading: false });
        }
      } catch (error) {
        if (isActive && requestId === latestRequest) {
          setState((previous) => ({
            book: previous.book,
            error: errorMessage(error),
            loading: false,
          }));
        }
      }
    };

    loadRef.current = () => void load();
    void load();

    const intervalId = window.setInterval(() => {
      // Pause polling while the tab is hidden; the next visible tick
      // refreshes the ladder within one interval.
      if (document.visibilityState === "hidden") {
        return;
      }

      void load();
    }, pollIntervalMs);

    return () => {
      isActive = false;
      loadRef.current = null;
      window.clearInterval(intervalId);
    };
  }, [chainId, marketId, pollIntervalMs]);

  useLiveChannel(
    chainId !== undefined && marketId !== undefined
      ? marketChannel(chainId, marketId)
      : null,
    () => loadRef.current?.()
  );

  return state;
}

export function orderBookRequestPath(lookup: OrderBookLookup) {
  const params = new URLSearchParams({
    chainId: String(lookup.chainId),
    marketId: lookup.marketId,
  });

  return `/api/indexer/orderbook?${params.toString()}`;
}

async function fetchOrderBook(
  chainId: number,
  marketId: string
): Promise<MarketOrderBook> {
  const response = await fetch(orderBookRequestPath({ chainId, marketId }), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Order book request failed (${response.status}).`);
  }

  return response.json() as Promise<MarketOrderBook>;
}

function errorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "load-order-book" },
    fallback: "Order book request failed.",
  });
}
