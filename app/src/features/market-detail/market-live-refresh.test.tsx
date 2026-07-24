import { serializeChangeSignal } from "@popcharts/live-channels";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveSignal } from "@/integrations/live-updates/live-connection";

import { MarketLiveRefresh } from "./market-live-refresh";

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
    handler: call[1] as (signal: LiveSignal) => void,
  };
}

const changeSignal: LiveSignal = {
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
    tick: null,
  }),
};

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.useLiveChannel.mockReset();
});

describe("MarketLiveRefresh", () => {
  it("subscribes to the market's channel for an api-backed id", () => {
    render(<MarketLiveRefresh marketAppId="31337:9" />);

    expect(lastSubscription().channel).toBe("market:31337:9");
  });

  it("subscribes to nothing for a fixture id with no chain:market encoding", () => {
    render(<MarketLiveRefresh marketAppId="sample-market" />);

    // A null channel makes the hook inert — a fixture market has no live
    // backend to hear from.
    expect(lastSubscription().channel).toBeNull();
  });

  it("refetches the page on any signal, change or reset", () => {
    render(<MarketLiveRefresh marketAppId="31337:9" />);
    const { handler } = lastSubscription();

    expect(mocks.refresh).not.toHaveBeenCalled();

    // The signal is only a nudge; the server component re-reads via
    // router.refresh, so a change and a reset drive the same full refetch.
    handler(changeSignal);
    handler({ type: "reset", reason: "cursor-too-old" });

    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("renders nothing", () => {
    const { container } = render(<MarketLiveRefresh marketAppId="31337:9" />);

    expect(container).toBeEmptyDOMElement();
  });
});
