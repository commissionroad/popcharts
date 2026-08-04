"use client";

import { marketChannel, type PriceTickWire } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

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

  const [live, setLive] = useState<LiveState>({ seeds: seedStreams, ticks: [] });

  // Reconcile to fresh SSR after a refetch. A server re-render reaches this
  // island with advanced seeds once a refetch has landed; the refreshed base
  // already holds every point through those ordinals, so keep only the ticks
  // beyond them. Dropping *all* of them would briefly lose the newest point
  // when a refetch raced an in-flight tick and returned an intermediate seed
  // (see `reseed`). Runs during render, not in an effect, so the throwaway
  // frame never double-plots points the base now contains.
  const seedsChanged = !seedsEqual(live.seeds, seedStreams);
  const reconciled = seedsChanged ? reseed(live, seedStreams) : live;
  if (seedsChanged) {
    setLive(reconciled);
  }
  const effective = reconciled;

  function handleSignal(signal: LiveSignal) {
    // Only the next consecutive price tick on its stream is an incremental
    // append; anything else falls back to a full refetch of SSR state.
    if (signal.type !== "change" || signal.tick === null) {
      router.refresh();
      return;
    }
    const { tick } = signal;
    const last = lastSequenceFor(effective, tick.stream);
    if (last !== undefined && tick.sequence <= last) {
      // Already reflected in the seeded or appended state — an SSR-vs-stream
      // overlap, or a frame the transport replayed on reconnect. Appending
      // would double-plot the point, so ignore it.
      return;
    }
    if (last !== undefined && tick.sequence > last + 1) {
      // A gap: at least one trade on this stream never reached us, so
      // appending from here would draw the wrong curve. Refetch to resync.
      router.refresh();
      return;
    }
    setLive((current) => {
      const currentLast = lastSequenceFor(current, tick.stream);
      // Re-check against the latest committed state, not just the render-time
      // value the branches above used: a second signal arriving in the same
      // React batch shares that stale closure, so only the genuinely next
      // tick per stream is appended here — never a duplicate or an
      // out-of-order point.
      if (currentLast !== undefined && tick.sequence !== currentLast + 1) {
        return current;
      }
      return { seeds: current.seeds, ticks: [...current.ticks, tick] };
    });
  }

  useLiveChannel(channel, handleSignal);

  const latest = effective.ticks.at(-1);
  const displayYesCents = latest ? latest.yesPriceCents : yesPriceCents;
  const displayNoCents = latest ? latest.noPriceCents : noPriceCents;
  // Appended ticks carry both outcomes, exactly like the unified points —
  // the wire shape and the read shape agree by design (repo ADR 0025).
  const chartPoints =
    effective.ticks.length === 0
      ? points
      : [
          ...points,
          ...effective.ticks.map((tick) => ({
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

/** SSR seed ordinals plus the ticks appended on top since the last read. */
type LiveState = {
  seeds: Record<string, number>;
  ticks: PriceTickWire[];
};

/** A stream's last known ordinal: its newest appended tick, else its seed. */
function lastSequenceFor(state: LiveState, stream: string): number | undefined {
  for (let index = state.ticks.length - 1; index >= 0; index -= 1) {
    const tick = state.ticks[index];

    if (tick && tick.stream === stream) {
      return tick.sequence;
    }
  }

  return state.seeds[stream];
}

/**
 * Re-seeds live state onto refreshed SSR ordinals: the new base already holds
 * every point through each stream's seed, so only ticks beyond it are kept.
 * Because ticks are only ever appended consecutively per stream, each kept
 * suffix stays consecutive with its seed — and a tick that raced the refetch
 * (already received but not yet in the base) survives instead of vanishing
 * until the next signal. A stream the new seeds do not mention keeps its
 * appended ticks whole: the unified read derives `streams` from the same rows
 * as the points, so a missing stream means the base holds none of its ticks.
 */
function reseed(state: LiveState, nextSeeds: Record<string, number>): LiveState {
  return {
    seeds: nextSeeds,
    ticks: state.ticks.filter((tick) => {
      const seed = nextSeeds[tick.stream];

      return seed === undefined || tick.sequence > seed;
    }),
  };
}

/** Shallow equality over seed maps, so a refetch with unchanged ordinals
 * (a non-price change) never churns appended ticks. */
function seedsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}
