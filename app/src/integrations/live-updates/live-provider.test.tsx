import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logError } from "@/lib/error-logger";

import { LiveProvider, useLiveConnection } from "./live-provider";
import { useLiveChannel } from "./use-live-channel";

vi.mock("@/lib/error-logger", () => ({ logError: vi.fn() }));

const API_URL = "NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener() {}
  close() {
    this.closed = true;
  }
}

/** Narrows the possibly-undefined index access the app's strict config yields. */
function requireInstance(index: number): FakeEventSource {
  const instance = FakeEventSource.instances[index];
  if (!instance) {
    throw new Error(`expected EventSource instance ${index}`);
  }
  return instance;
}

function installFakeEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Subscribes so the provider actually opens a socket. */
function Subscriber() {
  useLiveChannel("markets", () => {});
  return <span>subscribed</span>;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("LiveProvider", () => {
  it("renders children", () => {
    vi.stubEnv(API_URL, "http://api.test");
    render(
      <LiveProvider>
        <span>child</span>
      </LiveProvider>
    );
    expect(screen.getByText("child")).toBeDefined();
  });

  it("exposes no connection when no API origin is configured", () => {
    vi.stubEnv(API_URL, "");
    const { result } = renderHook(() => useLiveConnection(), {
      wrapper: ({ children }) => <LiveProvider>{children}</LiveProvider>,
    });
    // The fixture-backed sample-data build must not crash without a backend.
    expect(result.current).toBeNull();
  });

  it("exposes a connection when an API origin is configured", () => {
    vi.stubEnv(API_URL, "http://api.test");
    const { result } = renderHook(() => useLiveConnection(), {
      wrapper: ({ children }) => <LiveProvider>{children}</LiveProvider>,
    });
    expect(result.current).not.toBeNull();
  });

  it("returns null outside a provider", () => {
    const { result } = renderHook(() => useLiveConnection());
    expect(result.current).toBeNull();
  });

  it("drops the socket while hidden and restores it when visible again", async () => {
    vi.stubEnv(API_URL, "http://api.test");
    installFakeEventSource();

    render(
      <LiveProvider>
        <Subscriber />
      </LiveProvider>
    );
    await act(settle);
    expect(FakeEventSource.instances).toHaveLength(1);

    await act(async () => {
      setVisibility("hidden");
      await settle();
    });
    expect(requireInstance(0).closed).toBe(true);

    await act(async () => {
      setVisibility("visible");
      await settle();
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("routes connection failures to the app's error logger", async () => {
    vi.stubEnv(API_URL, "not a url");
    installFakeEventSource();

    render(
      <LiveProvider>
        <Subscriber />
      </LiveProvider>
    );
    await act(settle);

    // A misconfigured origin is reported, not thrown at the page.
    expect(logError).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("tears the connection down on unmount", async () => {
    vi.stubEnv(API_URL, "http://api.test");
    installFakeEventSource();

    const view = render(
      <LiveProvider>
        <Subscriber />
      </LiveProvider>
    );
    await act(settle);

    view.unmount();

    expect(requireInstance(0).closed).toBe(true);
  });
});
