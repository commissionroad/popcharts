"use client";

import { marketChannel, type PriceTickWire } from "@popcharts/live-channels";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { PriceCurve } from "@/components/charts/price-curve";
import type { PricePathPoint } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { parseApiMarketAppId } from "@/lib/app-id";
import { formatPercent } from "@/lib/format";

/**
 * The market's live price surface — the headline YES/NO and the price chart —
 * as one client island (repo ADR 0021, the sole "data-in-message" exception).
 *
 * A pregrad chart is append-mostly: each trade adds one point. Refetching the
 * whole receipt history and replaying the LMSR for every trade is O(history)
 * work for O(1) new information, so a pregrad trade instead rides its resulting
 * price on the change-feed frame (`signal.tick`) and this island appends that
 * point and moves the headline off the same tick — no refetch, no flicker.
 *
 * Everything else still resyncs from authoritative SSR state via a full
 * `router.refresh()` (the server page is a server component, so a refresh *is*
 * the whole-page refetch): a non-price change (graduation, resolution, a
 * cancel), a `reset` (the resume cursor aged out), or a **gap** in the tick
 * `sequence` — the ADR's "incremental steady-state, full refetch on
 * gap/reconnect". This one island therefore subsumes the old blunt
 * refresh-on-every-signal island; a single subscription owns the decision, so
 * an appended point can never be clobbered by a competing refetch.
 *
 * Seeding and reconciliation both key off `seedSequence` — the market's
 * `receiptCount`, which the indexer sets to the latest receipt's `sequence`, so
 * it is exactly the ordinal the SSR headline/chart already reflect. A tick is
 * the next point only when its `sequence` is `seedSequence + 1` (accounting for
 * ticks appended since). After a refetch the server re-renders with an advanced
 * `receiptCount`; the appended ticks are already folded into that fresh base,
 * so they are dropped and the island re-seeds — no double-plotted point.
 *
 * Source-agnostic over {@link PriceTickWire}: the postgrad price emit will push
 * the identical shape, so the same island handles it with no change here.
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
  marketAppId,
  noLabel,
  noPriceCents,
  points,
  seedSequence,
  yesLabel,
  yesPriceCents,
}: {
  chartHeading: string;
  children?: ReactNode;
  marketAppId: string;
  noLabel: string;
  noPriceCents: number;
  points: PricePathPoint[];
  seedSequence: number;
  yesLabel: string;
  yesPriceCents: number;
}) {
  const router = useRouter();
  const parsed = parseApiMarketAppId(marketAppId);
  const channel = parsed ? marketChannel(parsed.chainId, parsed.marketId) : null;

  const [live, setLive] = useState<LiveState>({ seedSequence, ticks: [] });

  // Reconcile to fresh SSR after a refetch. A server re-render reaches this
  // island with an advanced `seedSequence` once a refetch has landed; the
  // refreshed base already holds every receipt through that sequence, so keep
  // only the ticks beyond it. Dropping *all* of them would briefly lose the
  // newest point when a refetch raced an in-flight tick and returned an
  // intermediate seed (see `reseed`). Runs during render, not in an effect, so
  // the throwaway frame never double-plots points the base now contains.
  const reconciled = reseed(live, seedSequence);
  if (live.seedSequence !== seedSequence) {
    setLive(reconciled);
  }
  const effective = live.seedSequence === seedSequence ? live : reconciled;

  const lastSequence = effective.ticks.at(-1)?.sequence ?? effective.seedSequence;

  function handleSignal(signal: LiveSignal) {
    // Only the next consecutive price tick is an incremental append; anything
    // else falls back to a full refetch of authoritative SSR state.
    if (signal.type !== "change" || signal.tick === null) {
      router.refresh();
      return;
    }
    const { tick } = signal;
    if (tick.sequence <= lastSequence) {
      // Already reflected in the seeded or appended state — an SSR-vs-stream
      // overlap, or a frame the transport replayed on reconnect. Appending
      // would double-plot the point, so ignore it.
      return;
    }
    if (tick.sequence > lastSequence + 1) {
      // A gap: at least one receipt never reached us, so appending from here
      // would draw the wrong curve. Refetch to resync from the DB.
      router.refresh();
      return;
    }
    setLive((current) => {
      const currentLast = current.ticks.at(-1)?.sequence ?? current.seedSequence;
      // Re-check against the latest committed state, not just the render-time
      // `lastSequence` the branch above used: a second signal arriving in the
      // same React batch shares that stale closure, so only the genuinely next
      // tick is appended here — never a duplicate or an out-of-order point.
      if (tick.sequence !== currentLast + 1) {
        return current;
      }
      return { seedSequence: current.seedSequence, ticks: [...current.ticks, tick] };
    });
  }

  useLiveChannel(channel, handleSignal);

  const latest = effective.ticks.at(-1);
  const displayYesCents = latest ? latest.yesPriceCents : yesPriceCents;
  const displayNoCents = latest ? latest.noPriceCents : noPriceCents;
  const chartPoints =
    effective.ticks.length === 0
      ? points
      : [
          ...points,
          ...effective.ticks.map((tick) => ({
            at: tick.t,
            cents: tick.yesPriceCents,
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
        <PriceCurve noLabel={noLabel} points={chartPoints} yesLabel={yesLabel} />
      </div>
    </>
  );
}

/** SSR seed ordinal plus the ticks appended on top of it since the last read. */
type LiveState = {
  seedSequence: number;
  ticks: PriceTickWire[];
};

/**
 * Re-seeds live state onto a refreshed SSR sequence: the new base already holds
 * every receipt through `nextSeed`, so only ticks beyond it are kept. Because
 * ticks are only ever appended consecutively, the kept suffix stays consecutive
 * with `nextSeed` — and a tick that raced the refetch (already received but not
 * yet in the base) survives instead of vanishing until the next signal.
 */
function reseed(state: LiveState, nextSeed: number): LiveState {
  return {
    seedSequence: nextSeed,
    ticks: state.ticks.filter((tick) => tick.sequence > nextSeed),
  };
}
