"use client";

import type { Portfolio } from "@popcharts/api-client/models";
import { useCallback, useEffect, useState } from "react";

import { presentError } from "@/lib/error-handling";

/** Poll cadence for the portfolio page while it is mounted and visible. */
export const PORTFOLIO_POLL_INTERVAL_MS = 15_000;

/**
 * One wallet's indexed portfolio. `portfolio` stays null until the first
 * successful read; polls keep the previous payload on screen.
 */
export type PortfolioState = {
  error: string | null;
  loading: boolean;
  portfolio: Portfolio | null;
  refresh: () => void;
};

type PortfolioReadResult = {
  error: string | null;
  portfolio: Portfolio | null;
};

const EMPTY_RESULT: PortfolioReadResult = {
  error: null,
  portfolio: null,
};

/**
 * Polls the indexer for a wallet's portfolio (receipts, positions, open
 * orders). Orders fill and markets graduate while the page is open, so the
 * hook re-reads on a modest interval while the tab is visible (hidden tabs
 * skip the fetch but keep the schedule) and immediately after `refresh()`.
 * Returns a disabled state until an owner is available — the page renders its
 * connect-wallet empty state from that.
 *
 * Reads go through the same-origin `/api/indexer/portfolio` proxy (like the
 * order book), so the indexer base URL stays server-side: local dev only
 * exposes `POPCHARTS_INDEXER_API_URL`, not the `NEXT_PUBLIC_` variant, so a
 * direct browser fetch would have no URL to call.
 */
export function usePortfolio({
  chainId,
  owner,
}: {
  chainId: number | null;
  owner: string | null;
}): PortfolioState {
  const [pollTick, setPollTick] = useState(0);
  const [result, setResult] = useState<
    PortfolioReadResult & { requestKey: string | null }
  >({
    ...EMPTY_RESULT,
    requestKey: null,
  });
  const requestKey =
    chainId !== null && owner ? [chainId, owner, pollTick].join(":") : null;
  const refresh = useCallback(() => setPollTick((value) => value + 1), []);

  useEffect(() => {
    if (!requestKey || chainId === null || !owner) {
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
      }, PORTFOLIO_POLL_INTERVAL_MS);
    };

    readPortfolio({ chainId, owner })
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
              context: { chainId, operation: "load-portfolio", owner },
              fallback: "Could not load your portfolio.",
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
  }, [chainId, owner, requestKey]);

  if (requestKey === null) {
    return { ...EMPTY_RESULT, loading: false, refresh };
  }

  const settled = result.requestKey === requestKey;

  return {
    error: settled ? result.error : null,
    // Keep the previous read on screen while a poll is in flight so the page
    // does not flicker every interval.
    loading: !settled && result.portfolio === null,
    portfolio: result.portfolio,
    refresh,
  };
}

export function portfolioRequestPath({
  chainId,
  owner,
}: {
  chainId: number;
  owner: string;
}) {
  const params = new URLSearchParams({ chainId: String(chainId), owner });

  return `/api/indexer/portfolio?${params.toString()}`;
}

async function readPortfolio({
  chainId,
  owner,
}: {
  chainId: number;
  owner: string;
}): Promise<PortfolioReadResult> {
  const response = await fetch(portfolioRequestPath({ chainId, owner }), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Portfolio request failed (${response.status}).`);
  }

  return { error: null, portfolio: (await response.json()) as Portfolio };
}
