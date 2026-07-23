"use client";

import type { Portfolio } from "@popcharts/api-client/models";
import { portfolioChannel } from "@popcharts/live-channels";
import { useCallback, useEffect, useState } from "react";

import { useLiveConnection } from "@/integrations/live-updates/live-provider";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { presentError } from "@/lib/error-handling";

/** Poll cadence when no live transport is configured — the whole update path. */
export const PORTFOLIO_POLL_INTERVAL_MS = 15_000;
/**
 * Poll cadence when live signals drive refetches (repo ADR 0021): a safety
 * net for a missed signal or a down SSE stream, not the update path. The
 * portfolio is money-bearing, so it keeps a fallback even though every
 * balance, receipt, order, claim, and redemption change signals the owner's
 * channel.
 */
export const PORTFOLIO_FALLBACK_POLL_INTERVAL_MS = 120_000;

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
 * Reads a wallet's portfolio (receipts, positions, open orders) from the
 * indexer and keeps it fresh. With the live transport configured (repo ADR
 * 0021) the owner's portfolio channel nudges a re-read whenever a receipt,
 * balance transfer, maker order, claim, or redemption touches the wallet, and
 * the poll drops to a slow safety net; without it, the original interval is
 * the whole update path. Re-reads run while the tab is visible (hidden tabs
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
  const live = useLiveConnection() !== null;
  const pollIntervalMs = live
    ? PORTFOLIO_FALLBACK_POLL_INTERVAL_MS
    : PORTFOLIO_POLL_INTERVAL_MS;

  useLiveChannel(owner ? portfolioChannel(owner) : null, refresh);

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
      }, pollIntervalMs);
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
  }, [chainId, owner, pollIntervalMs, requestKey]);

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
