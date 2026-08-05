import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import type { LiveSignal } from "@/integrations/live-updates/live-connection";
import { marketFactory } from "@/test/factories/markets";

import { MarketCardLive } from "./market-card-live";

const mocks = vi.hoisted(() => ({
  useLiveChannel: vi.fn(),
}));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: mocks.useLiveChannel,
}));

/** The handler the island registered on the market-list channel. */
function emit(signal: LiveSignal) {
  const call = mocks.useLiveChannel.mock.calls.at(-1);
  if (!call) {
    throw new Error("useLiveChannel was never called");
  }
  act(() => (call[1] as (signal: LiveSignal) => void)(signal));
}

function tickSignal(fields: {
  blockNumber?: string;
  logIndex?: number;
  noPriceCents: number;
  sequence: number;
  stream?: string;
  yesPriceCents: number;
}): LiveSignal {
  const { blockNumber = null, logIndex = null, stream = "receipts", ...tick } = fields;
  return {
    type: "change",
    id: "1",
    channels: ["market:31337:9"],
    source: "receipt_placed_events",
    op: "insert",
    chainId: 31337,
    marketId: "9",
    owner: null,
    blockNumber,
    logIndex,
    tick: { t: "2026-08-04T00:00:00.000Z", stream, ...tick },
  } as LiveSignal;
}

function boardMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    id: "31337:9",
    noPriceCents: 60,
    receiptCount: 5,
    yesPriceCents: 40,
    ...overrides,
  });
}

beforeEach(() => {
  mocks.useLiveChannel.mockReset();
});

describe("MarketCardLive", () => {
  it("subscribes to its own market channel and shows SSR prices initially", () => {
    render(<MarketCardLive market={boardMarket()} />);

    expect(mocks.useLiveChannel.mock.calls.at(-1)?.[0]).toBe("market:31337:9");
    expect(screen.getByText("40c")).toBeInTheDocument();
    expect(screen.getByText("60c")).toBeInTheDocument();
  });

  it("subscribes to nothing for a fixture-backed market id", () => {
    render(<MarketCardLive market={boardMarket({ id: "eth-5000-august" })} />);

    expect(mocks.useLiveChannel.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("moves the card's prices with its market's next tick", () => {
    render(<MarketCardLive market={boardMarket()} />);

    emit(tickSignal({ noPriceCents: 48, sequence: 6, yesPriceCents: 52 }));

    expect(screen.getByText("52c")).toBeInTheDocument();
    expect(screen.getByText("48c")).toBeInTheDocument();
  });

  it("drops a frame that sits behind the newest accepted chain coordinate", () => {
    const yesPool = `0x${"aa".repeat(32)}`;
    const noPool = `0x${"bb".repeat(32)}`;
    render(<MarketCardLive market={boardMarket()} />);

    emit(
      tickSignal({
        blockNumber: "20",
        logIndex: 4,
        noPriceCents: 45,
        sequence: 3,
        stream: yesPool,
        yesPriceCents: 54,
      })
    );
    expect(screen.getByText("54c")).toBeInTheDocument();

    // The NO pool's frame is next on ITS stream but chain-earlier than the
    // shown price — applying it would move the chip backwards, so it drops.
    emit(
      tickSignal({
        blockNumber: "19",
        logIndex: 1,
        noPriceCents: 60,
        sequence: 2,
        stream: noPool,
        yesPriceCents: 40,
      })
    );
    expect(screen.getByText("54c")).toBeInTheDocument();

    // Same block, earlier log index: still behind, still dropped.
    emit(
      tickSignal({
        blockNumber: "20",
        logIndex: 1,
        noPriceCents: 61,
        sequence: 3,
        stream: noPool,
        yesPriceCents: 39,
      })
    );
    expect(screen.getByText("54c")).toBeInTheDocument();

    // A chain-later frame applies normally.
    emit(
      tickSignal({
        blockNumber: "21",
        logIndex: 0,
        noPriceCents: 47,
        sequence: 4,
        stream: noPool,
        yesPriceCents: 52,
      })
    );
    expect(screen.getByText("52c")).toBeInTheDocument();
  });

  it("never regresses on a replayed or stale ordinal", () => {
    render(<MarketCardLive market={boardMarket()} />);

    emit(tickSignal({ noPriceCents: 48, sequence: 6, yesPriceCents: 52 }));
    // A transport replay of an earlier receipt, and one at the SSR seed.
    emit(tickSignal({ noPriceCents: 70, sequence: 6, yesPriceCents: 30 }));
    emit(tickSignal({ noPriceCents: 80, sequence: 5, yesPriceCents: 20 }));

    expect(screen.getByText("52c")).toBeInTheDocument();
  });

  it("accepts a venue stream's first tick on trust, then strictly", () => {
    const pool = `0x${"aa".repeat(32)}`;
    render(<MarketCardLive market={boardMarket()} />);

    emit(
      tickSignal({
        noPriceCents: 45,
        sequence: 7,
        stream: pool,
        yesPriceCents: 54,
      })
    );
    expect(screen.getByText("54c")).toBeInTheDocument();

    emit(
      tickSignal({
        noPriceCents: 99,
        sequence: 7,
        stream: pool,
        yesPriceCents: 1,
      })
    );
    expect(screen.getByText("54c")).toBeInTheDocument();
  });

  it("ignores tick-less nudges and resets", () => {
    render(<MarketCardLive market={boardMarket()} />);

    emit({
      type: "change",
      id: "2",
      channels: ["markets"],
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

    expect(screen.getByText("40c")).toBeInTheDocument();
  });

  it("resets to a refetched SSR base and re-applies ticks on top", () => {
    const { rerender } = render(<MarketCardLive market={boardMarket()} />);

    emit(tickSignal({ noPriceCents: 48, sequence: 6, yesPriceCents: 52 }));

    // The board refetched: fresh SSR is authoritative over the shown tick.
    rerender(
      <MarketCardLive
        market={boardMarket({
          noPriceCents: 45,
          receiptCount: 7,
          yesPriceCents: 55,
        })}
      />
    );
    expect(screen.getByText("55c")).toBeInTheDocument();

    // The next receipt against the NEW seed appends over the new base;
    // one at or below it is stale.
    emit(tickSignal({ noPriceCents: 44, sequence: 8, yesPriceCents: 56 }));
    expect(screen.getByText("56c")).toBeInTheDocument();
    emit(tickSignal({ noPriceCents: 70, sequence: 7, yesPriceCents: 30 }));
    expect(screen.getByText("56c")).toBeInTheDocument();
  });
});
