"use client";

import type { Portfolio } from "@popcharts/api-client/models";
import { getGetPortfolioUrl } from "@popcharts/api-client/portfolio";
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
 * Returns a disabled state until the chain id, owner, and indexer URL are all
 * available — the page renders its connect-wallet empty state from that.
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
  const baseUrl = readIndexerApiBaseUrl();
  const requestKey =
    baseUrl && chainId !== null && owner ? [chainId, owner, pollTick].join(":") : null;
  const refresh = useCallback(() => setPollTick((value) => value + 1), []);

  useEffect(() => {
    if (!requestKey || !baseUrl || chainId === null || !owner) {
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

    readPortfolio({ baseUrl, chainId, owner })
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
  }, [baseUrl, chainId, owner, requestKey]);

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

async function readPortfolio({
  baseUrl,
  chainId,
  owner,
}: {
  baseUrl: string;
  chainId: number;
  owner: string;
}): Promise<PortfolioReadResult> {
  const url = buildIndexerUrl(baseUrl, getGetPortfolioUrl(String(chainId), { owner }));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Portfolio request failed (${response.status}).`);
  }

  return { error: null, portfolio: (await response.json()) as Portfolio };
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
