import { describe, expect, it, vi } from "vitest";

import {
  type EventSourceLike,
  LiveConnection,
  type LiveSignal,
} from "./live-connection";

// The connection batches subscribe/unsubscribe churn behind a timer, so tests
// use a 1ms delay plus a real flush. vi.useFakeTimers is avoided per the
// frontend-testing skill (it breaks act flushing in the React-side tests).
const REOPEN_MS = 1;
const flush = () => new Promise((resolve) => setTimeout(resolve, 8));

class FakeEventSource implements EventSourceLike {
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    } as MessageEvent);
  }
}

function setup(options: { baseUrl?: string } = {}) {
  const sources: FakeEventSource[] = [];
  const onError = vi.fn();
  const connection = new LiveConnection({
    baseUrl: options.baseUrl ?? "http://api.test",
    createEventSource: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    onError,
    reopenDelayMs: REOPEN_MS,
    maxBackoffMs: 50,
  });
  const latest = () => requireSource(sources[sources.length - 1]);
  return { connection, latest, onError, sources };
}

function requireOpened<T>(value: T | undefined): T {
  if (!value) {
    throw new Error("expected an EventSource to have been opened");
  }
  return value;
}

/** Narrows the possibly-undefined index access the app's strict config yields. */
function requireSource(source: FakeEventSource | undefined): FakeEventSource {
  if (!source) {
    throw new Error("expected an EventSource to have been opened");
  }
  return source;
}

function changeFrame(id: string, channels: string[], marketId = "42") {
  return {
    id,
    channels,
    source: "receipt_placed_events",
    op: "insert",
    chainId: 31337,
    marketId,
    owner: null,
    blockNumber: "1",
    logIndex: 0,
  };
}

describe("LiveConnection", () => {
  it("opens no socket until something subscribes", async () => {
    const { sources } = setup();
    await flush();
    expect(sources).toHaveLength(0);
  });

  it("opens one socket for the subscribed channels", async () => {
    const { connection, latest, sources } = setup();
    connection.subscribe("market:31337:42", vi.fn());
    connection.subscribe("markets", vi.fn());
    await flush();

    expect(sources).toHaveLength(1);
    const url = new URL(latest().url);
    expect(url.pathname).toBe("/events");
    // Sorted, so the channel set has a stable identity across renders.
    expect(url.searchParams.get("channels")).toBe("market:31337:42,markets");
    expect(url.searchParams.get("lastEventId")).toBeNull();
  });

  it("delivers a change only to handlers on a matching channel", async () => {
    const { connection, latest } = setup();
    const onMarket = vi.fn();
    const onOther = vi.fn();
    connection.subscribe("market:31337:42", onMarket);
    connection.subscribe("market:31337:99", onOther);
    await flush();

    latest().emit("change", changeFrame("5", ["market:31337:42"]));

    expect(onMarket).toHaveBeenCalledTimes(1);
    expect(onMarket.mock.calls[0]?.[0]).toMatchObject({
      type: "change",
      id: "5",
      source: "receipt_placed_events",
      marketId: "42",
    });
    expect(onOther).not.toHaveBeenCalled();
  });

  it("ignores channels in the frame that nothing is subscribed to", async () => {
    const { connection, latest } = setup();
    const onMarket = vi.fn();
    connection.subscribe("market:31337:42", onMarket);
    await flush();

    // The server names every channel a row routes to; we only hold one of them.
    latest().emit("change", changeFrame("6", ["market:31337:42", "markets"]));

    expect(onMarket).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending reopen when disposed before it fires", async () => {
    const { connection, sources } = setup();
    connection.subscribe("markets", vi.fn());
    connection.dispose(); // timer still pending
    await flush();

    expect(sources).toHaveLength(0);
  });

  it("ignores a repeated id so one change causes one refetch", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", changeFrame("7", ["markets"]));
    latest().emit("change", changeFrame("7", ["markets"]));

    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it("resumes from the highest id seen when it reopens", async () => {
    const { connection, latest } = setup();
    connection.subscribe("markets", vi.fn());
    await flush();
    latest().emit("change", changeFrame("9", ["markets"]));

    // A new channel forces a reopen; the cursor must ride along.
    connection.subscribe("market:31337:42", vi.fn());
    await flush();

    expect(new URL(latest().url).searchParams.get("lastEventId")).toBe("9");
  });

  it("still delivers a late lower id but does not rewind the cursor", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", changeFrame("10", ["markets"]));
    latest().emit("change", changeFrame("7", ["markets"])); // recovered gap id

    expect(onSignal).toHaveBeenCalledTimes(2);
    connection.subscribe("markets:other", vi.fn());
    await flush();
    expect(new URL(latest().url).searchParams.get("lastEventId")).toBe("10");
  });

  it("tells every subscriber to cold-refetch on reset and drops the cursor", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();
    latest().emit("change", changeFrame("4", ["markets"]));
    onSignal.mockClear();

    latest().emit("reset", { reason: "cursor-too-old" });

    expect(onSignal).toHaveBeenCalledWith({
      type: "reset",
      reason: "cursor-too-old",
    } satisfies LiveSignal);

    connection.subscribe("other", vi.fn());
    await flush();
    // Cursor cleared: asking for a gap past retention would be pointless.
    expect(new URL(latest().url).searchParams.get("lastEventId")).toBeNull();
  });

  it("falls back to a default reason when a reset payload is unreadable", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("reset", "not json");

    expect(onSignal).toHaveBeenCalledWith({
      type: "reset",
      reason: "cursor-too-old",
    });
  });

  it("reports a malformed change frame without dropping the connection", async () => {
    const { connection, latest, onError } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", "{{ not json");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSignal).not.toHaveBeenCalled();

    latest().emit("change", changeFrame("2", ["markets"]));
    expect(onSignal).toHaveBeenCalledTimes(1);
  });

  it("ignores a change frame with no usable id", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", { channels: ["markets"] });

    expect(onSignal).not.toHaveBeenCalled();
  });

  // Field-by-field defaulting is the shared contract's job and is covered
  // exhaustively in @popcharts/live-channels' own suite; re-listing all nine
  // fields here would just mirror the wire shape a third time. What this
  // asserts is the client's half: a degraded frame still reaches subscribers.
  it("tolerates missing/oddly-typed optional fields", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", { id: "3", channels: ["markets"], source: 42 });

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal.mock.calls[0]?.[0]).toMatchObject({
      type: "change",
      id: "3",
      channels: ["markets"],
      source: "",
    });
  });

  it("keeps notifying other subscribers when one throws", async () => {
    const { connection, latest, onError } = setup();
    const boom = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const ok = vi.fn();
    connection.subscribe("markets", boom);
    connection.subscribe("markets", ok);
    await flush();

    latest().emit("change", changeFrame("1", ["markets"]));

    expect(ok).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("closes the socket when the last subscriber leaves, and reopens later", async () => {
    const { connection, sources } = setup();
    const unsubscribe = connection.subscribe("markets", vi.fn());
    await flush();
    expect(requireSource(sources[0]).closed).toBe(false);

    unsubscribe();
    await flush();
    expect(requireSource(sources[0]).closed).toBe(true);

    connection.subscribe("markets", vi.fn());
    await flush();
    expect(sources).toHaveLength(2);
  });

  it("keeps the socket while a channel still has another subscriber", async () => {
    const { connection, sources } = setup();
    const first = connection.subscribe("markets", vi.fn());
    connection.subscribe("markets", vi.fn());
    await flush();

    first();
    await flush();

    expect(sources).toHaveLength(1);
    expect(requireSource(sources[0]).closed).toBe(false);
  });

  it("is inert for an unsubscribe called twice", async () => {
    const { connection, sources } = setup();
    const unsubscribe = connection.subscribe("markets", vi.fn());
    await flush();
    unsubscribe();
    unsubscribe();
    await flush();
    expect(requireSource(sources[0]).closed).toBe(true);
  });

  it("drops the socket while the tab is hidden and restores it on resume", async () => {
    const { connection, sources } = setup();
    connection.subscribe("markets", vi.fn());
    await flush();

    connection.pause();
    expect(requireSource(sources[0]).closed).toBe(true);
    connection.pause(); // idempotent

    connection.resume();
    connection.resume(); // idempotent
    await flush();

    expect(sources).toHaveLength(2);
  });

  it("reopens with backoff after a connection error", async () => {
    const { connection, latest, sources } = setup();
    connection.subscribe("markets", vi.fn());
    await flush();

    latest().listeners.get("error")?.({} as MessageEvent);
    await flush();
    expect(sources.length).toBeGreaterThanOrEqual(2);

    // A second failure doubles the delay rather than hot-looping.
    latest().listeners.get("error")?.({} as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  it("does not reopen after an error once nothing is subscribed", async () => {
    const { connection, latest, sources } = setup();
    const unsubscribe = connection.subscribe("markets", vi.fn());
    await flush();
    const source = latest();
    unsubscribe();
    await flush();

    source.listeners.get("error")?.({} as MessageEvent);
    await flush();

    expect(sources).toHaveLength(1);
  });

  it("stops everything on dispose", async () => {
    const { connection, sources } = setup();
    connection.subscribe("markets", vi.fn());
    await flush();

    connection.dispose();
    expect(requireSource(sources[0]).closed).toBe(true);

    connection.subscribe("markets", vi.fn());
    await flush();
    expect(sources).toHaveLength(1);
  });

  it("reports a bad base URL instead of throwing", async () => {
    const { connection, onError, sources } = setup({ baseUrl: "not a url" });
    connection.subscribe("markets", vi.fn());
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(0);
  });

  it("uses the platform EventSource and default timings when given only a base URL", async () => {
    const opened: Array<{ url: string }> = [];
    class GlobalEventSource {
      constructor(readonly url: string) {
        opened.push(this);
      }
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", GlobalEventSource);

    // Trailing slash exercises the other side of the base-URL join.
    const connection = new LiveConnection({ baseUrl: "http://api.test/" });
    connection.subscribe("markets", vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(opened).toHaveLength(1);
    expect(new URL(requireOpened(opened[0]).url).pathname).toBe("/events");

    connection.dispose();
    vi.unstubAllGlobals();
  });

  it("routes an owner-scoped change to its portfolio channel", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("portfolio:0xabc", onSignal);
    await flush();

    latest().emit("change", {
      id: "11",
      channels: ["portfolio:0xabc"],
      source: "graduated_receipt_claimed_events",
      marketId: "42",
      owner: "0xabc",
    });

    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "0xabc", marketId: "42" })
    );
  });

  it("survives frames that carry no data at all", async () => {
    const { connection, latest, onError } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", undefined);
    latest().emit("reset", undefined);

    expect(onError).toHaveBeenCalledTimes(1); // the unparseable change
    expect(onSignal).toHaveBeenCalledWith({
      type: "reset",
      reason: "cursor-too-old",
    });
  });

  it("ignores a frame whose channels field is not a list", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    latest().emit("change", { id: "8", channels: "markets" });

    expect(onSignal).not.toHaveBeenCalled();
  });

  it("does not rewind the cursor for a same-length lower id", async () => {
    const { connection, latest } = setup();
    connection.subscribe("markets", vi.fn());
    await flush();

    latest().emit("change", changeFrame("20", ["markets"]));
    latest().emit("change", changeFrame("15", ["markets"]));

    connection.subscribe("other", vi.fn());
    await flush();
    expect(new URL(latest().url).searchParams.get("lastEventId")).toBe("20");
  });

  it("bounds the dedup set so a long session cannot grow it forever", async () => {
    const { connection, latest } = setup();
    const onSignal = vi.fn();
    connection.subscribe("markets", onSignal);
    await flush();

    // Past the 500-id cap the oldest ids are evicted; re-emitting one then
    // delivers again, which is harmless (a signal is only ever a nudge).
    for (let index = 1; index <= 520; index += 1) {
      latest().emit("change", changeFrame(String(index), ["markets"]));
    }
    expect(onSignal).toHaveBeenCalledTimes(520);

    latest().emit("change", changeFrame("1", ["markets"]));
    expect(onSignal).toHaveBeenCalledTimes(521);
  });
});
