"use client";

import { MARKET_LIST_CHANNEL } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import type { LiveSignal } from "@/integrations/live-updates/live-connection";
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
 * Scope, deliberately: trades DO reach this channel (their frames carry the
 * resulting prices), but they are not this component's job — `MarketCardLive`
 * folds the tick payload into its card in place, so a tick-bearing frame is
 * skipped here rather than turned into the refetch-per-bet the original
 * design rejected. Card graduation bars and volume still settle on lifecycle
 * transitions or reload; making those live needs the trade size on the tick
 * payload (ADR 0025 deferred item).
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

  const refresh = useCallback(
    (signal: LiveSignal) => {
      // A tick-bearing trade frame is `MarketCardLive`'s to consume in place;
      // refetching the whole board per bet is exactly what routing trades
      // here must not cost.
      if (signal.type === "change" && signal.tick !== null) {
        return;
      }

      // Already scheduled: this signal is absorbed by the pending refetch,
      // which is what keeps a burst to one extra read.
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
    },
    [router]
  );

  useLiveChannel(MARKET_LIST_CHANNEL, refresh);

  return null;
}
