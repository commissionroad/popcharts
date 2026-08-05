"use client";

import {
  marketChannel,
  RECEIPTS_STREAM,
  type PriceTickWire,
} from "@popcharts/live-channels";
import { useState, type ReactNode } from "react";

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
 * Only a receipts-stream tick that carries both totals and advances the
 * ordinal is applied; venue ticks (which never move pregrad matching),
 * older-emitter ticks without the totals, tick-less nudges, and `reset`
 * signals leave the shown values alone — the page's refetch path settles
 * those. A refetched page reaches this island as new SSR props, which reset
 * live state; a fixture-backed market parses to no channel and the island is
 * inert. Cross-stream ordering needs no guard here: exactly one stream is
 * ever applied.
 *
 * `children` is the static remainder of the stats box (the `b` metric plus
 * any lifecycle links/buttons), rendered inside the island's grid so the
 * layout stays exactly the server component's.
 */
export function MarketLiveStats({
  children,
  market,
}: {
  children?: ReactNode;
  market: Market;
}) {
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
    if (!isReceiptTotalsTick(tick)) {
      return;
    }
    setState((current) => {
      if (tick.sequence <= current.receiptCount) {
        return current;
      }
      return {
        base: current.base,
        matchedUsd: tick.matchedUsd,
        receiptCount: tick.sequence,
        volumeUsd: tick.volumeUsd,
      };
    });
  }

  useLiveChannel(channel, handleSignal);

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
  volumeUsd: number;
};

function initialState(market: Market): StatsLiveState {
  return {
    base: statsKey(market),
    matchedUsd: market.matchedUsd,
    receiptCount: market.receiptCount,
    volumeUsd: market.volumeUsd,
  };
}

/** The SSR fields whose change means "a fresh authoritative read landed". */
function statsKey(market: Market): string {
  return `${market.receiptCount}|${market.volumeUsd}|${market.matchedUsd}`;
}

/** A receipts-stream tick carrying both post-trade totals. */
function isReceiptTotalsTick(
  tick: PriceTickWire
): tick is PriceTickWire & { matchedUsd: number; volumeUsd: number } {
  return (
    tick.stream === RECEIPTS_STREAM &&
    tick.matchedUsd !== undefined &&
    tick.volumeUsd !== undefined
  );
}
