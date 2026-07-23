"use client";

import { MARKET_LIST_CHANNEL } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";

/**
 * The board's refetch is coarse — it re-reads the whole (currently unpaginated)
 * market list — so a burst of lifecycle events must not turn into a burst of
 * full refetches. Leading edge fires immediately so an isolated transition
 * lands instantly; anything arriving inside the window collapses into a single
 * trailing refetch.
 */
export const DISCOVERY_COALESCE_WINDOW_MS = 1_000;

/**
 * Keeps the discovery board live (repo ADR 0021): subscribes to the global
 * market-list channel and re-reads the board when a market is created or
 * changes lifecycle state — graduating, graduated, refunding, cancelled,
 * resolved — or when its review verdict lands, for every viewer rather than
 * only the actor who caused it.
 *
 * Renders nothing. The board is a server component, so `router.refresh()` *is*
 * the authoritative re-read, and one handler serves both signal kinds: a
 * `change` nudge and a `reset` (the resume cursor aged past the server's
 * retention window) both want exactly a fresh read.
 *
 * Scope, deliberately: bets do NOT reach this channel — `receipt_placed_events`
 * routes to the per-market and owner channels only. So card prices, graduation
 * bars, and volume still settle on reload; only lifecycle transitions are live
 * here. Closing that needs either routing bets to this channel (every bet then
 * wakes every board viewer for a full list refetch) or paginating the board and
 * subscribing per visible card — deferred until the board is bounded.
 */
export function DiscoveryLiveRefresh() {
  const router = useRouter();
  /** Pending trailing refetch, if signals arrived inside the window. */
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    return () => {
      if (trailingRef.current) {
        clearTimeout(trailingRef.current);
      }
    };
  }, []);

  const refresh = useCallback(() => {
    // Already scheduled: this signal is absorbed by the pending refetch, which
    // is what keeps a burst to one extra read.
    if (trailingRef.current) {
      return;
    }

    const sinceLast = Date.now() - lastRefreshAtRef.current;
    if (sinceLast >= DISCOVERY_COALESCE_WINDOW_MS) {
      lastRefreshAtRef.current = Date.now();
      router.refresh();
      return;
    }

    trailingRef.current = setTimeout(() => {
      trailingRef.current = null;
      lastRefreshAtRef.current = Date.now();
      router.refresh();
    }, DISCOVERY_COALESCE_WINDOW_MS - sinceLast);
  }, [router]);

  useLiveChannel(MARKET_LIST_CHANNEL, refresh);

  return null;
}
