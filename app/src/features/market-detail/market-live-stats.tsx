"use client";

import {
  marketChannel,
  RECEIPTS_STREAM,
  type PriceTickWire,
} from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { GraduationBar } from "@/components/ui/graduation-bar";
import { SmallMetric } from "@/components/ui/small-metric";
import type { Market } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatUsdCompact } from "@/lib/format";

/**
 * The pregrad stats surface — graduation bar, volume, receipt count — moving
 * live off the same tick frames that move the chart (ADR 0025 follow-up).
 * Receipts-stream ticks carry the market's post-trade TOTALS (`matchedUsd`,
 * `volumeUsd` — totals, not deltas, so a dropped or replayed frame cannot
 * drift an accumulator), and the receipt count is the tick's own ordinal.
 *
 * The apply rule is the chart's, not last-write-wins: only the NEXT
 * consecutive receipts ordinal carrying both totals is folded in. Anything
 * else that advances the ordinal — a gap, or a totals-less tick from an
 * older emitter mid-rolling-deploy — means the shown values are knowably
 * behind with no frame to catch them up, so it bumps `resyncNonce` and the
 * effect refetches the page. This is also what keeps an out-of-order pair of
 * indexer emits from making an incomplete total authoritative: the
 * non-consecutive one refetches instead of sticking. Older/replayed
 * ordinals, venue ticks (which never move pregrad matching), tick-less
 * nudges, and `reset` signals are ignored — the price island owns the
 * nudge-driven refetch, so this island never doubles it.
 *
 * A refetched page reaches this island as new SSR props, which reset live
 * state (the reset key includes the market id, so client-navigating between
 * markets with coincidentally equal stats can never carry state across). A
 * fixture-backed market parses to no channel and the island is inert.
 *
 * `children` is the static remainder of the stats box (the `b` metric),
 * rendered inside the island's grid so the layout stays exactly the server
 * component's.
 */
export function MarketLiveStats({
  children,
  market,
}: {
  children?: ReactNode;
  market: Market;
}) {
  const router = useRouter();
  const parsed = parseApiMarketAppId(market.id);
  const channel = parsed ? marketChannel(parsed.chainId, parsed.marketId) : null;

  const [state, setState] = useState<StatsLiveState>(() => initialState(market));

  // Fresh SSR supersedes applied ticks: reset during render, never in an
  // effect, so a stale frame is never shown.
  if (state.base !== statsKey(market)) {
    setState(initialState(market));
  }

  function handleSignal(signal: LiveSignal) {
    if (signal.type !== "change" || signal.tick === null) {
      return;
    }
    const { tick } = signal;
    if (tick.stream !== RECEIPTS_STREAM) {
      return;
    }
    setState((current) => {
      if (tick.sequence <= current.receiptCount) {
        return current;
      }
      if (tick.sequence === current.receiptCount + 1 && hasTotals(tick)) {
        return {
          base: current.base,
          matchedUsd: tick.matchedUsd,
          receiptCount: tick.sequence,
          resyncNonce: current.resyncNonce,
          volumeUsd: tick.volumeUsd,
        };
      }
      // A gap, or a newer receipt whose frame lacks the totals: the shown
      // values are knowably behind and no future frame will fill them in.
      return { ...current, resyncNonce: current.resyncNonce + 1 };
    });
  }

  useLiveChannel(channel, handleSignal);

  // One refetch per nonce increment (the ref remembers the last one handled,
  // so an unrelated effect re-run cannot refetch again).
  const resyncNonce = state.resyncNonce;
  const handledResyncNonce = useRef(0);
  useEffect(() => {
    if (resyncNonce > handledResyncNonce.current) {
      handledResyncNonce.current = resyncNonce;
      router.refresh();
    }
  }, [resyncNonce, router]);

  return (
    <>
      <GraduationBar
        matchedUsd={state.matchedUsd}
        targetUsd={market.graduationTargetUsd}
      />
      <div className="mt-5 grid gap-3 border-t border-[var(--border-soft)] pt-5 sm:grid-cols-3">
        <SmallMetric label="Volume" value={formatUsdCompact(state.volumeUsd)} />
        <SmallMetric label="Receipts" value={state.receiptCount.toLocaleString()} />
        {children}
      </div>
    </>
  );
}

type StatsLiveState = {
  /** Which SSR base the live state was built on (see {@link statsKey}). */
  base: string;
  matchedUsd: number;
  receiptCount: number;
  /** Counts detected gaps/degraded frames; the effect refetches per bump. */
  resyncNonce: number;
  volumeUsd: number;
};

function initialState(market: Market): StatsLiveState {
  return {
    base: statsKey(market),
    matchedUsd: market.matchedUsd,
    receiptCount: market.receiptCount,
    resyncNonce: 0,
    volumeUsd: market.volumeUsd,
  };
}

/** The SSR identity+fields whose change means "a fresh authoritative read of
 * THIS market landed". */
function statsKey(market: Market): string {
  return `${market.id}|${market.receiptCount}|${market.volumeUsd}|${market.matchedUsd}`;
}

/** A tick carrying both post-trade totals. */
function hasTotals(
  tick: PriceTickWire
): tick is PriceTickWire & { matchedUsd: number; volumeUsd: number } {
  return tick.matchedUsd !== undefined && tick.volumeUsd !== undefined;
}
