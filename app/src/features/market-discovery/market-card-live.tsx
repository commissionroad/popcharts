"use client";

import { MARKET_LIST_CHANNEL, RECEIPTS_STREAM } from "@popcharts/live-channels";
import { useState } from "react";

import { MarketCard } from "@/components/ui/market-card";
import type { Market } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";

/**
 * A discovery card whose YES/NO prices move with the market (repo ADR 0025
 * follow-up): trades — pregrad receipts and postgrad venue swaps alike — ride
 * their resulting prices on the market-list channel's tick payload, and this
 * island folds the latest tick for ITS market into the card. That payload is
 * the whole point of routing bets to the board: updating two numbers in place
 * costs nothing per viewer, where the refetch-per-bet design this replaces
 * was rejected for waking every board viewer into a full list re-read.
 *
 * Ticks for other markets, tick-less frames (lifecycle nudges — those belong
 * to `DiscoveryLiveRefresh`), and `reset` signals are ignored here.
 *
 * The staleness guard is proportionate to a price chip, not a chart: per
 * stream, only a strictly increasing ordinal replaces the shown price (so a
 * transport replay can never regress the chip), the receipts stream is seeded
 * from the SSR `receiptCount`, and a venue stream's first tick is accepted on
 * trust. Cross-stream chain ordering — which the market page's chart does
 * enforce — is deliberately not re-implemented for a two-number display where
 * last-arrival-wins is indistinguishable in practice.
 *
 * A refetched board reaches this island as a new `market` prop; SSR is
 * authoritative, so live state resets to it and ticks re-apply on top. A
 * fixture-backed market has no chain-prefixed id, matches no signal, and the
 * island stays inert.
 */
export function MarketCardLive({ market }: { market: Market }) {
  const [state, setState] = useState<CardLiveState>(() => initialState(market));

  // Fresh SSR (a board refetch) supersedes appended ticks: reset to the new
  // base during render, never in an effect, so the stale frame is not shown.
  if (state.base !== marketPriceKey(market)) {
    setState(initialState(market));
  }

  function handleSignal(signal: LiveSignal) {
    if (signal.type !== "change" || signal.tick === null) {
      return;
    }
    if (`${signal.chainId}:${signal.marketId}` !== market.id) {
      return;
    }
    const { tick } = signal;
    setState((current) => {
      const last = current.seen[tick.stream];
      if (last !== undefined && tick.sequence <= last) {
        return current;
      }
      return {
        base: current.base,
        prices: {
          noPriceCents: tick.noPriceCents,
          yesPriceCents: tick.yesPriceCents,
        },
        seen: { ...current.seen, [tick.stream]: tick.sequence },
      };
    });
  }

  useLiveChannel(MARKET_LIST_CHANNEL, handleSignal);

  return (
    <MarketCard
      market={state.prices === null ? market : { ...market, ...state.prices }}
    />
  );
}

type CardLiveState = {
  /** Which SSR base the live state was built on (see {@link marketPriceKey}). */
  base: string;
  /** The latest accepted tick's prices, or null before any tick. */
  prices: { noPriceCents: number; yesPriceCents: number } | null;
  /** Last accepted ordinal per stream — the replay/stale guard. */
  seen: Record<string, number>;
};

function initialState(market: Market): CardLiveState {
  return {
    base: marketPriceKey(market),
    prices: null,
    seen: { [RECEIPTS_STREAM]: market.receiptCount },
  };
}

/** The SSR fields whose change means "a fresh authoritative read landed". */
function marketPriceKey(market: Market): string {
  return `${market.receiptCount}|${market.yesPriceCents}|${market.noPriceCents}`;
}
