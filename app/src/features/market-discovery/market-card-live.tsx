"use client";

import { marketChannel, RECEIPTS_STREAM } from "@popcharts/live-channels";
import { useState } from "react";

import { MarketCard } from "@/components/ui/market-card";
import type { Market } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { parseApiMarketAppId } from "@/lib/app-id";

/**
 * A discovery card whose YES/NO prices move with the market (repo ADR 0025
 * follow-up): trades — pregrad receipts and postgrad venue swaps alike — ride
 * their resulting prices on the market's own channel's tick payload, and this
 * island folds the latest tick into the card in place. Each card subscribes to
 * its OWN market channel — where trade frames already route — rather than the
 * global list channel, so a trade wakes exactly the one card it belongs to
 * and the list channel stays lifecycle-only. The board is bounded by the
 * API's list limit, which bounds the per-card subscriptions with it (the
 * shared connection multiplexes them onto one socket).
 *
 * Tick-less frames (the market's lifecycle nudges) and `reset` signals are
 * ignored here — `DiscoveryLiveRefresh` owns the board refetch.
 *
 * The staleness guard is proportionate to a price chip, not a chart: per
 * stream, only a strictly increasing ordinal is accepted (so a transport
 * replay can never regress the chip), the receipts stream is seeded from the
 * SSR `receiptCount`, a venue stream's first tick is accepted on trust, and —
 * because the two venue pools are separate streams — a frame that sits
 * strictly behind the newest accepted chain coordinate is dropped rather than
 * allowed to overwrite a newer price. Unlike the market page's chart, a
 * rejected frame here needs no refetch: the newer price is already the one
 * shown.
 *
 * A refetched board reaches this island as a new `market` prop; SSR is
 * authoritative, so live state resets to it and ticks re-apply on top. A
 * fixture-backed market has no chain-prefixed id, parses to null, and the
 * island stays inert.
 */
export function MarketCardLive({ market }: { market: Market }) {
  const parsed = parseApiMarketAppId(market.id);
  const channel = parsed ? marketChannel(parsed.chainId, parsed.marketId) : null;

  const [state, setState] = useState<CardLiveState>(() => initialState(market));

  // Fresh SSR (a board refetch) supersedes applied ticks: reset to the new
  // base during render, never in an effect, so the stale frame is not shown.
  if (state.base !== marketPriceKey(market)) {
    setState(initialState(market));
  }

  function handleSignal(signal: LiveSignal) {
    if (signal.type !== "change" || signal.tick === null) {
      return;
    }
    const { tick } = signal;
    const coord = frameCoord(signal);
    setState((current) => {
      const last = current.seen[tick.stream];
      if (last !== undefined && tick.sequence <= last) {
        return current;
      }
      if (
        coord !== null &&
        current.coord !== null &&
        compareCoords(coord, current.coord) < 0
      ) {
        // In-order on its own stream but chain-earlier than the price already
        // shown (the sibling pool's) — applying it would move the chip
        // backwards. The shown price is the newer one, so just drop it.
        return current;
      }
      return {
        base: current.base,
        coord: coord ?? current.coord,
        prices: {
          noPriceCents: tick.noPriceCents,
          yesPriceCents: tick.yesPriceCents,
        },
        seen: { ...current.seen, [tick.stream]: tick.sequence },
      };
    });
  }

  useLiveChannel(channel, handleSignal);

  return (
    <MarketCard
      market={state.prices === null ? market : { ...market, ...state.prices }}
    />
  );
}

/** Chain coordinates of an accepted frame, for cross-stream ordering. */
type ChainCoord = {
  blockNumber: bigint;
  logIndex: number;
};

type CardLiveState = {
  /** Which SSR base the live state was built on (see {@link marketPriceKey}). */
  base: string;
  /** The newest accepted frame's chain coordinates, when it carried them. */
  coord: ChainCoord | null;
  /** The latest accepted tick's prices, or null before any tick. */
  prices: { noPriceCents: number; yesPriceCents: number } | null;
  /** Last accepted ordinal per stream — the replay/stale guard. */
  seen: Record<string, number>;
};

function initialState(market: Market): CardLiveState {
  return {
    base: marketPriceKey(market),
    coord: null,
    prices: null,
    seen: { [RECEIPTS_STREAM]: market.receiptCount },
  };
}

/** The SSR fields whose change means "a fresh authoritative read landed". */
function marketPriceKey(market: Market): string {
  return `${market.receiptCount}|${market.yesPriceCents}|${market.noPriceCents}`;
}

/** The chain coordinates of a `change` frame, when it carries them. */
function frameCoord(signal: LiveSignal & { type: "change" }): ChainCoord | null {
  if (signal.blockNumber === null || signal.logIndex === null) {
    return null;
  }

  return { blockNumber: BigInt(signal.blockNumber), logIndex: signal.logIndex };
}

/** Chain order: block number first, log index within the block. */
function compareCoords(a: ChainCoord, b: ChainCoord): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }

  return a.logIndex - b.logIndex;
}
