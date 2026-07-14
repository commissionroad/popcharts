"use client";

import type { MarketOrderBook, VenueOrder } from "@popcharts/api-client/models";
import { useCallback, useEffect, useState } from "react";

import { presentError } from "@/lib/error-handling";

/** Poll cadence for the open-orders panel while it is mounted and visible. */
export const OPEN_ORDERS_POLL_INTERVAL_MS = 8_000;

/**
 * One wallet's open maker orders on a market, plus the freshest pool prices
 * the poll saw (poolId -> display price WAD) for crossed-order detection.
 * `orders` stays null until the first successful read.
 */
export type OpenVenueOrdersState = {
  error: string | null;
  loading: boolean;
  orders: VenueOrder[] | null;
  poolPricesWad: Readonly<Record<string, string>>;
  refresh: () => void;
};

type OrdersReadResult = {
  error: string | null;
  orders: VenueOrder[] | null;
  poolPricesWad: Readonly<Record<string, string>>;
};

const EMPTY_RESULT: OrdersReadResult = {
  error: null,
  orders: null,
  poolPricesWad: {},
};

/**
 * Polls the indexer for a wallet's open maker orders on one market. Deferred
 * keeper fills mean a crossed order can stay open for a few seconds, so the
 * panel re-reads on a modest interval while the tab is visible (hidden tabs
 * skip the fetch but keep the schedule) and re-reads immediately after
 * `refresh()` or a `refreshKey` bump. Returns a disabled state until the
 * chain id, market id, and owner are all available.
 *
 * Reads go through the same-origin `/api/indexer/venue-orders` and
 * `/api/indexer/orderbook` proxies (like the portfolio page), so the indexer
 * base URL stays server-side: local dev only exposes
 * `POPCHARTS_INDEXER_API_URL`, not the `NEXT_PUBLIC_` variant, so a direct
 * browser fetch would have no URL to call.
 */
export function useOpenVenueOrders({
  chainId,
  marketId,
  owner,
  refreshKey,
}: {
  chainId: number | null;
  marketId: string | null;
  owner: string | null;
  refreshKey: number;
}): OpenVenueOrdersState {
  const [pollTick, setPollTick] = useState(0);
  const [result, setResult] = useState<
    OrdersReadResult & { requestKey: string | null }
  >({
    ...EMPTY_RESULT,
    requestKey: null,
  });
  const requestKey =
    chainId !== null && marketId && owner
      ? [chainId, marketId, owner, refreshKey, pollTick].join(":")
      : null;
  const refresh = useCallback(() => setPollTick((value) => value + 1), []);

  useEffect(() => {
    if (!requestKey || chainId === null || !marketId || !owner) {
      return;
    }

    let isActive = true;
    let timeoutId: number | undefined;

    const schedule = () => {
      timeoutId = window.setTimeout(() => {
        // Skip the read while the tab is hidden; the next visible tick
        // catches up.
        if (document.visibilityState === "hidden") {
          schedule();
          return;
        }

        setPollTick((value) => value + 1);
      }, OPEN_ORDERS_POLL_INTERVAL_MS);
    };

    readOpenVenueOrders({ chainId, marketId, owner })
      .then((read) => {
        if (isActive) {
          setResult({ ...read, requestKey });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setResult({
            ...EMPTY_RESULT,
            error: presentError(error, {
              context: { chainId, marketId, operation: "load-open-orders" },
              fallback: "Could not load your open orders.",
            }),
            requestKey,
          });
        }
      })
      .finally(() => {
        if (isActive) {
          schedule();
        }
      });

    return () => {
      isActive = false;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [chainId, marketId, owner, requestKey]);

  if (requestKey === null) {
    return { ...EMPTY_RESULT, loading: false, refresh };
  }

  const settled = result.requestKey === requestKey;

  return {
    error: settled ? result.error : null,
    // Keep the previous read on screen while a poll is in flight so rows do
    // not flicker every interval.
    loading: !settled && result.orders === null,
    orders: result.orders,
    poolPricesWad: result.poolPricesWad,
    refresh,
  };
}

export function venueOrdersRequestPath({
  chainId,
  marketId,
  owner,
}: {
  chainId: number;
  marketId: string;
  owner: string;
}) {
  const params = new URLSearchParams({
    chainId: String(chainId),
    marketId,
    owner,
  });

  return `/api/indexer/venue-orders?${params.toString()}`;
}

async function readOpenVenueOrders({
  chainId,
  marketId,
  owner,
}: {
  chainId: number;
  marketId: string;
  owner: string;
}): Promise<OrdersReadResult> {
  const bookParams = new URLSearchParams({
    chainId: String(chainId),
    marketId,
  });
  const [orders, book] = await Promise.all([
    fetchJson<VenueOrder[]>(venueOrdersRequestPath({ chainId, marketId, owner })),
    fetchJson<MarketOrderBook>(`/api/indexer/orderbook?${bookParams.toString()}`),
  ]);
  const poolPricesWad: Record<string, string> = {};

  for (const pool of [book.yes, book.no]) {
    if (pool?.marketPriceWad) {
      poolPricesWad[pool.poolId.toLowerCase()] = pool.marketPriceWad;
    }
  }

  return { error: null, orders, poolPricesWad };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Open orders request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}
