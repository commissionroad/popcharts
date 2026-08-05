import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISCOVERY_COALESCE_WINDOW_MS,
  DiscoveryLiveRefresh,
} from "./discovery-live-refresh";

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

/** The (channel, handler) the component passed to useLiveChannel this render. */
function lastSubscription() {
  const call = mocks.useLiveChannel.mock.calls.at(-1);
  if (!call) {
    throw new Error("useLiveChannel was never called");
  }
  return {
    channel: call[0] as string | null,
    handler: call[1] as (signal: unknown) => void,
  };
}

/** A payload-less lifecycle nudge — the signal kind that refetches the board. */
function nudge() {
  return { type: "change", tick: null };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.useLiveChannel.mockReset();
  vi.useFakeTimers();
  // A non-zero clock so the first signal reads as "outside the window" and
  // takes the leading edge, which is what a real page load sees.
  vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DiscoveryLiveRefresh", () => {
  it("subscribes to the global market-list channel", () => {
    render(<DiscoveryLiveRefresh />);

    expect(lastSubscription().channel).toBe("markets");
  });

  it("ignores tick-bearing trade frames — those are the cards' to consume", () => {
    render(<DiscoveryLiveRefresh />);

    lastSubscription().handler({
      type: "change",
      tick: {
        t: "2026-08-04T00:00:00.000Z",
        stream: "receipts",
        sequence: 3,
        yesPriceCents: 52,
        noPriceCents: 48,
      },
    });

    // No refetch now, and none scheduled for later either.
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DISCOVERY_COALESCE_WINDOW_MS * 2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("refetches immediately on an isolated signal", () => {
    render(<DiscoveryLiveRefresh />);

    lastSubscription().handler(nudge());

    // Leading edge: a lone lifecycle transition must not wait out the window.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one trailing refetch", () => {
    render(<DiscoveryLiveRefresh />);
    const { handler } = lastSubscription();

    handler(nudge());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // Three more inside the window — e.g. a keeper sweep graduating several
    // markets — must cost exactly one more full board read, not three.
    handler(nudge());
    handler(nudge());
    handler(nudge());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DISCOVERY_COALESCE_WINDOW_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("takes the leading edge again once the window has passed", () => {
    render(<DiscoveryLiveRefresh />);
    const { handler } = lastSubscription();

    handler(nudge());
    vi.advanceTimersByTime(DISCOVERY_COALESCE_WINDOW_MS);

    handler(nudge());

    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("drops a pending refetch when the board unmounts", () => {
    const view = render(<DiscoveryLiveRefresh />);
    const { handler } = lastSubscription();

    handler(nudge());
    handler(nudge()); // schedules the trailing refetch
    view.unmount();

    vi.advanceTimersByTime(DISCOVERY_COALESCE_WINDOW_MS * 2);

    // Only the leading edge ran; the trailing timer must not fire into an
    // unmounted tree.
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("unmounts cleanly with no refetch pending", () => {
    const view = render(<DiscoveryLiveRefresh />);

    expect(() => view.unmount()).not.toThrow();
  });

  it("renders nothing", () => {
    const { container } = render(<DiscoveryLiveRefresh />);

    expect(container).toBeEmptyDOMElement();
  });
});
