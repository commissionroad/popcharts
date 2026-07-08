"use client";

import type { MarketOrderBook } from "@popcharts/api-client/models";
import { useEffect, useState } from "react";

export const ORDER_BOOK_POLL_INTERVAL_MS = 5_000;

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
 * proxy route and re-polls it every five seconds while the tab is visible,
 * so the ladder tracks resting maker orders without websockets. A null
 * lookup (fixture-backed market) disables fetching entirely. Poll failures
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

  useEffect(() => {
    if (chainId === undefined || marketId === undefined) {
      return;
    }

    let isActive = true;
    setState({ book: null, error: null, loading: true });

    const load = async () => {
      try {
        const book = await fetchOrderBook(chainId, marketId);

        if (isActive) {
          setState({ book, error: null, loading: false });
        }
      } catch (error) {
        if (isActive) {
          setState((previous) => ({
            book: previous.book,
            error: errorMessage(error),
            loading: false,
          }));
        }
      }
    };

    void load();

    const intervalId = window.setInterval(() => {
      // Pause polling while the tab is hidden; the next visible tick
      // refreshes the ladder within one interval.
      if (document.visibilityState === "hidden") {
        return;
      }

      void load();
    }, ORDER_BOOK_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [chainId, marketId]);

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
  return error instanceof Error ? error.message : "Order book request failed.";
}
