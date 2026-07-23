"use client";

import { marketChannel } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { parseApiMarketAppId } from "@/lib/app-id";

/**
 * Keeps a market's server-rendered detail page live (repo ADR 0021): subscribes
 * to the market's channel and re-reads the page whenever any other actor's
 * on-chain activity — a bet, a graduation, a resolution — touches it, replacing
 * the old own-trade-only refresh.
 *
 * Renders nothing. Because the page is a server component, `router.refresh()`
 * *is* the whole-page refetch, which is why one handler serves both signal
 * kinds: a `change` nudge and a `reset` (the resume cursor aged out of the
 * server's retention window) both want exactly a fresh authoritative read.
 * That the signal carries no data is the point — a duplicate or replayed one
 * costs at most one redundant refetch.
 *
 * `marketAppId` is the app-facing "chainId:marketId". A fixture-backed sample
 * market has no colon-encoded id, so it parses to null and the subscription is
 * inert — correct, since such a market has no live backend to hear from.
 */
export function MarketLiveRefresh({ marketAppId }: { marketAppId: string }) {
  const router = useRouter();
  const parsed = parseApiMarketAppId(marketAppId);
  const channel = parsed ? marketChannel(parsed.chainId, parsed.marketId) : null;

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useLiveChannel(channel, refresh);

  return null;
}
