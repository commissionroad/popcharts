"use client";

import { marketChannel, type PriceTickWire } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { PriceCurve } from "@/components/charts/price-curve";
import type { PricePoint } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatPercent } from "@/lib/format";

/**
 * The market's live price surface — the headline YES/NO and the price chart —
 * as one client island (repo ADR 0021, the sole "data-in-message" exception).
 *
 * A price chart is append-mostly: each trade adds one point. Refetching the
 * whole history for every trade is O(history) work for O(1) new information,
 * so a trade instead rides its resulting price on the change-feed frame
 * (`signal.tick`) and this island appends that point and moves the headline
 * off the same tick — no refetch, no flicker. Since ADR 0025 this holds on
 * both sides of graduation: pregrad receipts and postgrad venue swaps push
 * the same `PriceTickWire`, differing only in which `stream` they belong to.
 *
 * Everything else still resyncs from authoritative SSR state via a full
 * `router.refresh()`: a non-price change (graduation, resolution, a cancel),
 * a `reset` (the resume cursor aged out), or a **gap** in a stream's
 * `sequence` — the ADR's "incremental steady-state, full refetch on
 * gap/reconnect".
 *
 * The gap check is **per stream** (ADR 0025 P5). Each stream — the receipt
 * book, or one venue pool — numbers its own ticks contiguously with a
 * chain-assigned ordinal, so `sequence === last + 1` is checked against that
 * stream's own last-known ordinal. `seedStreams` carries each stream's
 * ordinal as of the SSR read: `receiptCount` for the receipts stream, the
 * unified read's per-pool `streams` for the venue. A tick for a stream with
 * no seed (the venue's very first swap, or a fallback render whose read
 * failed) has nothing to check against and is appended on trust — every
 * subsequent tick on that stream is then checked strictly, and a refetch
 * reconciles everything to the durable base anyway.
 *
 * Two orderings the per-stream check alone cannot see, and how each is
 * closed:
 *
 * - **Cross-stream delivery order.** Ticks from different streams pass their
 *   own sequence checks in any interleaving, so nothing above stops a frame
 *   that reached us behind a chain-later sibling from being plotted after it.
 *   Every appended frame therefore also carries its chain coordinates
 *   (`blockNumber`, `logIndex`), and a frame that lands strictly behind the
 *   newest appended coordinate refetches instead of appending backwards.
 * - **Stale-closure races.** The whole append/gap decision runs inside the
 *   functional updater (`applyTick`), never against a render-time closure,
 *   so the second of two same-batch frames is judged against the first. A
 *   detected gap bumps `resyncNonce` from within the pure updater, and the
 *   nonce effect performs the `router.refresh()` — exactly once per bump.
 *
 * Deferred (see the PR): the graduation bar, volume, and receipt counts still
 * settle via the refetch path, because `matchedUsd` is not in the tick payload
 * (it carries prices + sequence only). Carrying it too is a follow-up on the
 * server emit.
 *
 * `marketAppId` is the app-facing "chainId:marketId". A fixture-backed sample
 * market has no colon-encoded id, so it parses to null and the subscription is
 * inert — correct, since such a market has no live backend to hear from.
 */
export function MarketLivePrice({
  chartHeading,
  children,
  graduatedAt,
  marketAppId,
  noLabel,
  noPriceCents,
  points,
  seedStreams,
  yesLabel,
  yesPriceCents,
}: {
  chartHeading: string;
  children?: ReactNode;
  /** ISO graduation time, when the market has graduated. */
  graduatedAt?: string;
  marketAppId: string;
  noLabel: string;
  noPriceCents: number;
  /** Whole-life history from the unified read (repo ADR 0025), oldest first. */
  points: PricePoint[];
  /** Last known ordinal per stream as of the SSR read. */
  seedStreams: Record<string, number>;
  yesLabel: string;
  yesPriceCents: number;
}) {
  const router = useRouter();
  const parsed = parseApiMarketAppId(marketAppId);
  const channel = parsed ? marketChannel(parsed.chainId, parsed.marketId) : null;

  const [live, setLive] = useState<LiveState>(() => ({
    resyncNonce: 0,
    seeds: seedStreams,
    ticks: [],
  }));

  // Reconcile to fresh SSR after a refetch. A server re-render reaches this
  // island with advanced seeds once a refetch has landed; the refreshed base
  // already holds every point through those ordinals, so keep only the ticks
  // beyond them (see `reseed` for the contiguity rule). Runs during render,
  // not in an effect, so the throwaway frame never double-plots points the
  // base now contains.
  const seedsChanged = !seedsEqual(live.seeds, seedStreams);
  const effective = seedsChanged ? reseed(live, seedStreams) : live;
  if (seedsChanged) {
    setLive(effective);
  }

  function handleSignal(signal: LiveSignal) {
    // Only the next consecutive price tick on its stream is an incremental
    // append; anything else falls back to a full refetch of SSR state.
    if (signal.type !== "change" || signal.tick === null) {
      router.refresh();
      return;
    }
    const { tick } = signal;
    const coord = frameCoord(signal);
    // The whole append/gap decision runs inside the functional updater, so a
    // burst of signals in one React batch each judges against its
    // predecessor's result instead of a stale render-time closure — the
    // second of two frames can neither double-plot nor slip past the gap
    // check. A gap can't call `router.refresh()` from in here (updaters are
    // pure and may re-run), so it bumps `resyncNonce` and the effect below
    // performs the refetch.
    setLive((current) => applyTick(current, tick, coord));
  }

  useLiveChannel(channel, handleSignal);

  // One refetch per nonce increment — the ref remembers the last nonce
  // already refetched for, so a re-render that re-runs the effect for any
  // other reason (a changed router identity, say) does not refetch again.
  const resyncNonce = live.resyncNonce;
  const handledResyncNonce = useRef(0);
  useEffect(() => {
    if (resyncNonce > handledResyncNonce.current) {
      handledResyncNonce.current = resyncNonce;
      router.refresh();
    }
  }, [resyncNonce, router]);

  const latest = effective.ticks.at(-1)?.tick;
  const displayYesCents = latest ? latest.yesPriceCents : yesPriceCents;
  const displayNoCents = latest ? latest.noPriceCents : noPriceCents;
  // Appended ticks carry both outcomes, exactly like the unified points —
  // the wire shape and the read shape agree by design (repo ADR 0025).
  const chartPoints =
    effective.ticks.length === 0
      ? points
      : [
          ...points,
          ...effective.ticks.map(({ tick }) => ({
            at: tick.t,
            noCents: tick.noPriceCents,
            yesCents: tick.yesPriceCents,
          })),
        ];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-7">
        <div>
          <span className="font-display tabular text-5xl font-black text-[var(--yes)]">
            {formatPercent(displayYesCents)}
          </span>
          <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
            {yesLabel}
          </span>
        </div>
        <div>
          <span className="font-display tabular text-3xl font-black text-[var(--no)]">
            {formatPercent(displayNoCents)}
          </span>
          <span className="ml-2 font-mono text-xs text-[var(--text-muted)]">
            {noLabel}
          </span>
        </div>
      </div>

      {children}

      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5">
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          {chartHeading}
        </div>
        <PriceCurve
          {...(graduatedAt === undefined ? {} : { graduatedAt })}
          noLabel={noLabel}
          points={chartPoints}
          yesLabel={yesLabel}
        />
      </div>
    </>
  );
}

/** Chain coordinates of an appended frame, for cross-stream ordering. */
type ChainCoord = {
  blockNumber: bigint;
  logIndex: number;
};

/** One appended live point: the tick plus where its frame sat on the chain
 * (null when the frame carried no coordinates — the ordering guard stands
 * down for that frame rather than inventing an order). */
type AppendedTick = {
  coord: ChainCoord | null;
  tick: PriceTickWire;
};

/** SSR seed ordinals plus the ticks appended on top since the last read.
 * `resyncNonce` counts detected gaps/ordering regressions; the island's
 * effect refetches once per increment. */
type LiveState = {
  resyncNonce: number;
  seeds: Record<string, number>;
  ticks: AppendedTick[];
};

/**
 * The per-tick state transition: append when the tick is the next
 * consecutive ordinal on its stream AND not behind the newest appended
 * chain coordinate; ignore a stale replay; bump `resyncNonce` on a gap or
 * an ordering regression so the effect refetches. Pure, so it is safe as a
 * React updater.
 */
function applyTick(
  current: LiveState,
  tick: PriceTickWire,
  coord: ChainCoord | null
): LiveState {
  const last = lastSequenceFor(current, tick.stream);
  if (last !== undefined && tick.sequence <= last) {
    // Already reflected in the seeded or appended state — an SSR-vs-stream
    // overlap, or a frame the transport replayed on reconnect. Appending
    // would double-plot the point, so ignore it.
    return current;
  }
  if (last !== undefined && tick.sequence > last + 1) {
    // A gap: at least one trade on this stream never reached us, so
    // appending from here would draw the wrong curve. Refetch to resync.
    return { ...current, resyncNonce: current.resyncNonce + 1 };
  }
  const lastCoord = lastAppendedCoord(current);
  if (coord !== null && lastCoord !== null && compareCoords(coord, lastCoord) < 0) {
    // In-order within its own stream, but behind a sibling stream's newest
    // appended point on the chain — plotting it now would draw the curve
    // backwards in time. Refetch; the base orders by chain coordinates.
    return { ...current, resyncNonce: current.resyncNonce + 1 };
  }

  return { ...current, ticks: [...current.ticks, { coord, tick }] };
}

/** A stream's last known ordinal: its newest appended tick, else its seed. */
function lastSequenceFor(state: LiveState, stream: string): number | undefined {
  for (let index = state.ticks.length - 1; index >= 0; index -= 1) {
    const appended = state.ticks[index];

    if (appended && appended.tick.stream === stream) {
      return appended.tick.sequence;
    }
  }

  return state.seeds[stream];
}

/** The chain coordinates of a `change` frame, when it carries them. */
function frameCoord(signal: LiveSignal & { type: "change" }): ChainCoord | null {
  if (signal.blockNumber === null || signal.logIndex === null) {
    return null;
  }

  return { blockNumber: BigInt(signal.blockNumber), logIndex: signal.logIndex };
}

/** The newest appended coordinate, skipping coordinate-less frames. */
function lastAppendedCoord(state: LiveState): ChainCoord | null {
  for (let index = state.ticks.length - 1; index >= 0; index -= 1) {
    const coord = state.ticks[index]?.coord;

    if (coord) {
      return coord;
    }
  }

  return null;
}

/** Chain order: block number first, log index within the block. */
function compareCoords(a: ChainCoord, b: ChainCoord): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }

  return a.logIndex - b.logIndex;
}

/**
 * Re-seeds live state onto refreshed SSR ordinals: the new base already holds
 * every point through each stream's seed, so only ticks beyond it are kept —
 * and only when they are **contiguous** with it. A kept suffix whose first
 * ordinal is not `seed + 1` means the base ends before ticks we never saw
 * (the stream was unseeded when they arrived, so nothing gap-checked them),
 * and keeping the suffix would plot around a hole; those ticks are dropped
 * instead, and the next live tick on that stream reads as a gap against the
 * seed and triggers the refetch that heals it. A stream the new seeds do not
 * mention keeps its appended ticks whole: the unified read derives `streams`
 * from the same rows as the points, so a missing stream means the base holds
 * none of its ticks.
 */
function reseed(state: LiveState, nextSeeds: Record<string, number>): LiveState {
  const kept = state.ticks.filter(({ tick }) => {
    const seed = nextSeeds[tick.stream];

    return seed === undefined || tick.sequence > seed;
  });
  const dropped = new Set<string>();
  for (const [stream, seed] of Object.entries(nextSeeds)) {
    const first = kept.find(({ tick }) => tick.stream === stream);

    if (first && first.tick.sequence !== seed + 1) {
      dropped.add(stream);
    }
  }

  return {
    resyncNonce: state.resyncNonce,
    seeds: nextSeeds,
    ticks:
      dropped.size === 0 ? kept : kept.filter(({ tick }) => !dropped.has(tick.stream)),
  };
}

/** Shallow equality over seed maps, so a refetch with unchanged ordinals
 * (a non-price change) never churns appended ticks. */
function seedsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}
