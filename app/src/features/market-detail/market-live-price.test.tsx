import { type PriceTickWire, serializeChangeSignal } from "@popcharts/live-channels";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PricePathPoint } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";

import { MarketLivePrice } from "./market-live-price";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  useLiveChannel: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: mocks.useLiveChannel,
}));

// The chart is rendered for real in the page integration test; here it is a
// stub so the island's own logic — which points and prices it derives — is what
// gets asserted, independent of the SVG plotting.
vi.mock("@/components/charts/price-curve", () => ({
  PriceCurve: ({
    noLabel,
    points,
    yesLabel,
  }: {
    noLabel: string;
    points: PricePathPoint[];
    yesLabel: string;
  }) => (
    <div data-testid="price-curve">
      <span data-testid="chart-labels">{`${yesLabel}/${noLabel}`}</span>
      <span data-testid="chart-latest-cents">{points.at(-1)?.cents ?? "none"}</span>
      <span data-testid="chart-point-count">{points.length}</span>
    </div>
  ),
}));

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.useLiveChannel.mockReset();
});

describe("MarketLivePrice", () => {
  it("subscribes to the market's channel for an api-backed id", () => {
    renderIsland();

    expect(lastSubscription().channel).toBe("market:31337:9");
  });

  it("subscribes to nothing for a fixture id with no chain:market encoding", () => {
    renderIsland({ marketAppId: "sample-market" });

    // A null channel makes the hook inert — a fixture market has no live
    // backend to hear from.
    expect(lastSubscription().channel).toBeNull();
  });

  it("seeds the headline and chart from the SSR props", () => {
    renderIsland();

    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("36%")).toBeInTheDocument();
    // The chart is seeded with the SSR path, latest point 48c.
    expect(screen.getByTestId("chart-latest-cents")).toHaveTextContent("48");
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("2");
    expect(screen.getByTestId("chart-labels")).toHaveTextContent("YES/NO");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("renders the settled summary passed as children and the chart heading", () => {
    renderIsland({
      chartHeading: "Pre-graduation price history",
      children: <div>settled summary</div>,
    });

    expect(screen.getByText("settled summary")).toBeInTheDocument();
    expect(screen.getByText("Pre-graduation price history")).toBeInTheDocument();
  });

  it("appends a consecutive price tick to the chart and headline without refetching", () => {
    renderIsland();

    emit(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 30 }));

    // The headline moves to the tick's prices and the chart gains its point.
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.queryByText("64%")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-latest-cents")).toHaveTextContent("70");
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("3");
    // The whole point of the tick: no O(history) refetch to add one point.
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reads the headline NO price from the tick, not one-minus-YES", () => {
    renderIsland();

    // A deliberately inconsistent tick pins that the NO headline comes from the
    // tick's own noPriceCents field rather than being recomputed as 100 - YES.
    emit(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 25 }));

    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("appends consecutive ticks in sequence order", () => {
    renderIsland();

    emit(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 30 }));
    emit(tickSignal({ sequence: 7, yesPriceCents: 72, noPriceCents: 28 }));

    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByTestId("chart-latest-cents")).toHaveTextContent("72");
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("4");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("ignores a stale or duplicate tick already reflected in the seed", () => {
    renderIsland();

    // sequence 5 == the seed's receiptCount: an SSR-vs-stream overlap. Appending
    // it would double-plot the last seeded point, so it is dropped.
    emit(tickSignal({ sequence: 5, yesPriceCents: 90, noPriceCents: 10 }));

    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.queryByText("90%")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("2");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refetches on a sequence gap instead of appending", () => {
    renderIsland();

    // sequence 8 skips 6 and 7: the append base would be wrong, so resync from
    // authoritative SSR state via a full refetch.
    emit(tickSignal({ sequence: 8, yesPriceCents: 90, noPriceCents: 10 }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("2");
  });

  it("refetches on a reset signal", () => {
    renderIsland();

    emit({ type: "reset", reason: "cursor-too-old" });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("refetches on a non-price change signal", () => {
    renderIsland();

    // A lifecycle change (graduation, resolution, a cancel) carries no tick, so
    // it drives the same full refetch the old blunt island did.
    emit(tickSignal(null));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("reconciles to fresh SSR props after a refetch, dropping appended ticks", () => {
    const { rerender } = renderIsland();

    emit(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 30 }));
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("3");

    // A refetch lands: the server re-renders with an advanced receiptCount and a
    // fresh path that already folds in the appended point. The island re-seeds
    // and the stale appended tick is gone — no double-plot.
    rerender(
      <MarketLivePrice
        chartHeading="Virtual LMSR - implied probability"
        marketAppId="31337:9"
        noLabel="NO"
        noPriceCents={29}
        points={[{ cents: 40 }, { cents: 71 }]}
        seedSequence={8}
        yesLabel="YES"
        yesPriceCents={71}
      />
    );

    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.queryByText("70%")).not.toBeInTheDocument();
    expect(screen.getByTestId("chart-latest-cents")).toHaveTextContent("71");
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("2");
  });

  it("keeps an appended tick a refetch that raced it has not yet caught up to", () => {
    const { rerender } = renderIsland();

    emit(tickSignal({ sequence: 6, yesPriceCents: 60, noPriceCents: 40 }));
    emit(tickSignal({ sequence: 7, yesPriceCents: 65, noPriceCents: 35 }));
    emit(tickSignal({ sequence: 8, yesPriceCents: 70, noPriceCents: 30 }));
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("5");

    // The refetch was in flight when tick 8 arrived, so its base only reaches
    // sequence 7. Tick 8 (beyond the base) must survive the re-seed rather than
    // vanish until the next signal; ticks 6 and 7 are now in the base.
    rerender(
      <MarketLivePrice
        chartHeading="Virtual LMSR - implied probability"
        marketAppId="31337:9"
        noLabel="NO"
        noPriceCents={35}
        points={[{ cents: 40 }, { cents: 60 }, { cents: 65 }]}
        seedSequence={7}
        yesLabel="YES"
        yesPriceCents={65}
      />
    );

    // Base (3 points) + the retained tick 8; the headline tracks tick 8, not the
    // seed prop.
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByTestId("chart-latest-cents")).toHaveTextContent("70");
    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("4");
  });

  it("drops a duplicate tick delivered in the same React batch", () => {
    renderIsland();
    const { handler } = lastSubscription();

    // Two frames for the same sequence flushed together: the render-time
    // decision cannot see the first append while judging the second, so the
    // functional updater must reject the duplicate. Only one point lands.
    act(() => {
      handler(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 30 }));
      handler(tickSignal({ sequence: 6, yesPriceCents: 70, noPriceCents: 30 }));
    });

    expect(screen.getByTestId("chart-point-count")).toHaveTextContent("3");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

/** The (channel, handler) the island passed to useLiveChannel this render. */
function lastSubscription() {
  const call = mocks.useLiveChannel.mock.calls.at(-1);
  if (!call) {
    throw new Error("useLiveChannel was never called");
  }
  return {
    channel: call[0] as string | null,
    handler: call[1] as (signal: LiveSignal) => void,
  };
}

/** Delivers a signal through the latest captured handler inside act(). */
function emit(signal: LiveSignal) {
  const { handler } = lastSubscription();
  act(() => {
    handler(signal);
  });
}

/** A `change` frame carrying a price tick, or with `null` a pure nudge (a
 * lifecycle change that drives a refetch). `t` is filled in so callers vary
 * only the fields the decision keys on. */
function tickSignal(fields: Omit<PriceTickWire, "t"> | null): LiveSignal {
  return {
    type: "change",
    ...serializeChangeSignal({
      id: 1n,
      channels: ["market:31337:9"],
      sourceTable: "receipt_placed_events",
      op: "insert",
      chainId: 31337,
      marketId: "9",
      owner: null,
      blockNumber: null,
      logIndex: null,
      tick: fields === null ? null : { t: TICK_TIME, ...fields },
    }),
  };
}

const TICK_TIME = "2026-07-24T12:00:00.000Z";

function renderIsland(overrides: Partial<MarketLivePriceProps> = {}) {
  return render(<MarketLivePrice {...islandProps(overrides)} />);
}

type MarketLivePriceProps = Parameters<typeof MarketLivePrice>[0];

function islandProps(
  overrides: Partial<MarketLivePriceProps> = {}
): MarketLivePriceProps {
  return {
    chartHeading: "Virtual LMSR - implied probability",
    marketAppId: "31337:9",
    noLabel: "NO",
    noPriceCents: 36,
    points: [{ cents: 40 }, { cents: 48 }],
    seedSequence: 5,
    yesLabel: "YES",
    yesPriceCents: 64,
    ...overrides,
  };
}
