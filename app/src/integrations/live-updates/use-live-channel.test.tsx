import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LiveConnection, LiveSignal } from "./live-connection";
import { LiveConnectionContext } from "./live-provider";
import { useLiveChannel } from "./use-live-channel";

function fakeConnection() {
  const unsubscribe = vi.fn();
  const handlers: Array<(signal: LiveSignal) => void> = [];
  const subscribe = vi.fn((_channel: string, handler: (signal: LiveSignal) => void) => {
    handlers.push(handler);
    return unsubscribe;
  });
  const connection = { subscribe } as unknown as LiveConnection;
  return { connection, subscribe, unsubscribe, handlers };
}

/** Narrows the possibly-undefined index access the app's strict config yields. */
function firstHandler(handlers: Array<(signal: LiveSignal) => void>) {
  const handler = handlers[0];
  if (!handler) {
    throw new Error("expected a subscription handler");
  }
  return handler;
}

function wrapperFor(connection: LiveConnection | null) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <LiveConnectionContext.Provider value={connection}>
      {children}
    </LiveConnectionContext.Provider>
  );
  Wrapper.displayName = "LiveTestWrapper";
  return Wrapper;
}

const CHANNEL = "market:31337:42";

describe("useLiveChannel", () => {
  it("subscribes on mount and unsubscribes on unmount", () => {
    const { connection, subscribe, unsubscribe } = fakeConnection();
    const view = renderHook(() => useLiveChannel(CHANNEL, vi.fn()), {
      wrapper: wrapperFor(connection),
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]?.[0]).toBe(CHANNEL);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("delivers signals to the handler", () => {
    const { connection, handlers } = fakeConnection();
    const onSignal = vi.fn();
    renderHook(() => useLiveChannel(CHANNEL, onSignal), {
      wrapper: wrapperFor(connection),
    });

    const signal: LiveSignal = {
      type: "change",
      id: "1",
      channels: [CHANNEL],
      source: "receipt_placed_events",
      marketId: "42",
      owner: null,
    };
    firstHandler(handlers)(signal);

    expect(onSignal).toHaveBeenCalledWith(signal);
  });

  it("does not resubscribe when only the handler identity changes", () => {
    const { connection, subscribe, handlers } = fakeConnection();
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(
      ({ handler }: { handler: () => void }) => useLiveChannel(CHANNEL, handler),
      { initialProps: { handler: first }, wrapper: wrapperFor(connection) }
    );

    view.rerender({ handler: second });

    // One subscription across renders, and the newest handler wins.
    expect(subscribe).toHaveBeenCalledTimes(1);
    firstHandler(handlers)({ type: "reset", reason: "cursor-too-old" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("resubscribes when the channel changes", () => {
    const { connection, subscribe, unsubscribe } = fakeConnection();
    const view = renderHook(
      ({ channel }: { channel: string }) => useLiveChannel(channel, vi.fn()),
      { initialProps: { channel: CHANNEL }, wrapper: wrapperFor(connection) }
    );

    view.rerender({ channel: "markets" });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1]?.[0]).toBe("markets");
  });

  it("subscribes to nothing for a null channel", () => {
    const { connection, subscribe } = fakeConnection();
    renderHook(() => useLiveChannel(null, vi.fn()), {
      wrapper: wrapperFor(connection),
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("is inert without a connection", () => {
    const onSignal = vi.fn();
    expect(() =>
      renderHook(() => useLiveChannel(CHANNEL, onSignal), {
        wrapper: wrapperFor(null),
      })
    ).not.toThrow();
    expect(onSignal).not.toHaveBeenCalled();
  });
});
