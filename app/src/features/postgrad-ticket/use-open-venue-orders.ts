"use client";

import {
  getGetMarketOrderBookUrl,
  getListMarketOrdersUrl,
} from "@popcharts/api-client/markets";
import type { MarketOrderBook, VenueOrder } from "@popcharts/api-client/models";
import { useCallback, useEffect, useState } from "react";

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
 * chain id, market id, owner, and indexer URL are all available.
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
  const baseUrl = readIndexerApiBaseUrl();
  const requestKey =
    baseUrl && chainId !== null && marketId && owner
      ? [chainId, marketId, owner, refreshKey, pollTick].join(":")
      : null;
  const refresh = useCallback(() => setPollTick((value) => value + 1), []);

  useEffect(() => {
    if (!requestKey || !baseUrl || chainId === null || !marketId || !owner) {
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

    readOpenVenueOrders({ baseUrl, chainId, marketId, owner })
      .then((read) => {
        if (isActive) {
          setResult({ ...read, requestKey });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setResult({
            ...EMPTY_RESULT,
            error:
              error instanceof Error && error.message
                ? error.message
                : "Could not load your open orders.",
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
  }, [baseUrl, chainId, marketId, owner, requestKey]);

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

async function readOpenVenueOrders({
  baseUrl,
  chainId,
  marketId,
  owner,
}: {
  baseUrl: string;
  chainId: number;
  marketId: string;
  owner: string;
}): Promise<OrdersReadResult> {
  const [orders, book] = await Promise.all([
    fetchJson<VenueOrder[]>(
      buildIndexerUrl(
        baseUrl,
        getListMarketOrdersUrl(String(chainId), marketId, { owner })
      )
    ),
    fetchJson<MarketOrderBook>(
      buildIndexerUrl(baseUrl, getGetMarketOrderBookUrl(String(chainId), marketId))
    ),
  ]);
  const poolPricesWad: Record<string, string> = {};

  for (const pool of [book.yes, book.no]) {
    if (pool?.marketPriceWad) {
      poolPricesWad[pool.poolId.toLowerCase()] = pool.marketPriceWad;
    }
  }

  return { error: null, orders, poolPricesWad };
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Open orders request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

function buildIndexerUrl(baseUrl: string, path: string) {
  return new URL(
    path.replace(/^\//, ""),
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  );
}

/**
 * The indexer API base URL exposed to the browser. Read at call time so tests
 * can stub the env var.
 */
function readIndexerApiBaseUrl() {
  return process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL ?? null;
}
