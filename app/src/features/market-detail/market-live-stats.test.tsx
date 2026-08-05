import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { marketFactory } from "@/test/factories/markets";

import { MarketLiveStats } from "./market-live-stats";

const mocks = vi.hoisted(() => ({
  useLiveChannel: vi.fn(),
}));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: mocks.useLiveChannel,
}));

/** The handler the island registered on the market's channel. */
function emit(signal: LiveSignal) {
  const call = mocks.useLiveChannel.mock.calls.at(-1);
  if (!call) {
    throw new Error("useLiveChannel was never called");
  }
  act(() => (call[1] as (signal: LiveSignal) => void)(signal));
}

function tickSignal(fields: {
  matchedUsd?: number;
  noPriceCents?: number;
  sequence: number;
  stream?: string;
  volumeUsd?: number;
  yesPriceCents?: number;
}): LiveSignal {
  const {
    noPriceCents = 48,
    stream = "receipts",
    yesPriceCents = 52,
    ...rest
  } = fields;
  return {
    type: "change",
    id: "1",
    channels: ["market:31337:9"],
    source: "receipt_placed_events",
    op: "insert",
    chainId: 31337,
    marketId: "9",
    owner: null,
    blockNumber: null,
    logIndex: null,
    tick: {
      t: "2026-08-04T00:00:00.000Z",
      stream,
      noPriceCents,
      yesPriceCents,
      ...rest,
    },
  } as LiveSignal;
}

function statsMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    graduationTargetUsd: 2_500,
    id: "31337:9",
    matchedUsd: 400,
    receiptCount: 5,
    volumeUsd: 1_000,
    ...overrides,
  });
}

beforeEach(() => {
  mocks.useLiveChannel.mockReset();
});

describe("MarketLiveStats", () => {
  it("subscribes to its market channel and shows the SSR stats", () => {
    render(<MarketLiveStats market={statsMarket()} />);

    expect(mocks.useLiveChannel.mock.calls.at(-1)?.[0]).toBe("market:31337:9");
    expect(screen.getByText("$1K")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("subscribes to nothing for a fixture-backed market id", () => {
    render(<MarketLiveStats market={statsMarket({ id: "eth-5000-august" })} />);

    expect(mocks.useLiveChannel.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("moves volume, receipts, and the graduation bar with a totals tick", () => {
    render(<MarketLiveStats market={statsMarket()} />);

    emit(tickSignal({ matchedUsd: 812.5, sequence: 6, volumeUsd: 1_250 }));

    expect(screen.getByText("$1.3K")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    // The graduation bar's numerator reflects the pushed matched total.
    expect(screen.getByText("$813")).toBeInTheDocument();
  });

  it("ignores an older or replayed ordinal", () => {
    render(<MarketLiveStats market={statsMarket()} />);

    emit(tickSignal({ matchedUsd: 812.5, sequence: 6, volumeUsd: 1_250 }));
    emit(tickSignal({ matchedUsd: 1, sequence: 5, volumeUsd: 1 }));
    emit(tickSignal({ matchedUsd: 2, sequence: 6, volumeUsd: 2 }));

    expect(screen.getByText("$1.3K")).toBeInTheDocument();
  });

  it("ignores ticks without totals and non-receipt streams", () => {
    render(<MarketLiveStats market={statsMarket()} />);

    // An older emitter's tick: prices only, no totals.
    emit(tickSignal({ sequence: 6 }));
    // A venue tick never moves pregrad stats, whatever it carries.
    emit(
      tickSignal({
        matchedUsd: 9_999,
        sequence: 1,
        stream: `0x${"aa".repeat(32)}`,
        volumeUsd: 9_999,
      })
    );

    expect(screen.getByText("$1K")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("ignores tick-less nudges and resets", () => {
    render(<MarketLiveStats market={statsMarket()} />);

    emit({
      type: "change",
      id: "2",
      channels: ["market:31337:9"],
      source: "market_resolutions",
      op: "insert",
      chainId: 31337,
      marketId: "9",
      owner: null,
      blockNumber: null,
      logIndex: null,
      tick: null,
    } as LiveSignal);
    emit({ type: "reset", reason: "cursor aged out" });

    expect(screen.getByText("$1K")).toBeInTheDocument();
  });

  it("resets to fresh SSR stats and applies newer ticks on top", () => {
    const { rerender } = render(<MarketLiveStats market={statsMarket()} />);

    emit(tickSignal({ matchedUsd: 812.5, sequence: 6, volumeUsd: 1_250 }));

    rerender(
      <MarketLiveStats
        market={statsMarket({
          matchedUsd: 900,
          receiptCount: 7,
          volumeUsd: 1_400,
        })}
      />
    );
    expect(screen.getByText("$1.4K")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    emit(tickSignal({ matchedUsd: 950, sequence: 8, volumeUsd: 1_500 }));
    expect(screen.getByText("$1.5K")).toBeInTheDocument();
    emit(tickSignal({ matchedUsd: 1, sequence: 7, volumeUsd: 1 }));
    expect(screen.getByText("$1.5K")).toBeInTheDocument();
  });

  it("renders the static children inside the metrics grid", () => {
    render(
      <MarketLiveStats market={statsMarket()}>
        <div>b metric child</div>
      </MarketLiveStats>
    );

    expect(screen.getByText("b metric child")).toBeInTheDocument();
  });
});
