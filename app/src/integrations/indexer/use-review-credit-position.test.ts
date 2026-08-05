import type { MarketDraftReviewCredit } from "@popcharts/api-client/models";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { useReviewCreditPosition } from "./use-review-credit-position";

const liveMocks = vi.hoisted(() => ({ useLiveChannel: vi.fn() }));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: liveMocks.useLiveChannel,
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

/** Mixed case on purpose: channels and queries must both see it lowercased. */
const ADDRESS = "0x1111111111111111111111111111111111111111";
const CHECKSUMMED = "0x1111111111111111111111111111111111111111".toUpperCase();

const POSITION: MarketDraftReviewCredit = {
  availableWad: "10700000000000000000",
  metered: true,
  rateWad: "100000000000000000",
  runsRemaining: 107,
  runsUsed: 6,
};

/** The (channel, handler) pair the hook subscribed with this render. */
function lastSubscription() {
  const call = liveMocks.useLiveChannel.mock.calls.at(-1);

  if (!call) {
    throw new Error("useLiveChannel was never called");
  }

  return { channel: call[0] as string | null, handler: call[1] as () => void };
}

function connectWallet(address: string | null) {
  vi.mocked(useWalletAccount).mockReturnValue({
    address,
    getDraftAuthHeaders: async () => ({}),
    ownerUserId: address,
  } as unknown as ReturnType<typeof useWalletAccount>);
}

/** Types the call signature so assertions can read the requested URL back. */
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(...responses: MarketDraftReviewCredit[]) {
  const fetcher = vi.fn<FetchStub>(async () => {
    const body = responses.length > 1 ? responses.shift() : responses[0];

    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  });

  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

beforeEach(() => {
  connectWallet(ADDRESS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useReviewCreditPosition", () => {
  it("reads the connected wallet's position", async () => {
    const fetcher = stubFetch(POSITION);
    const { result } = renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(result.current.credit).toEqual(POSITION));
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(ADDRESS);
  });

  it("lowercases the address before querying", async () => {
    connectWallet(CHECKSUMMED);
    const fetcher = stubFetch(POSITION);
    renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(ADDRESS);
  });

  it("stays null with no wallet connected and never fetches", () => {
    connectWallet(null);
    const fetcher = stubFetch(POSITION);
    const { result } = renderHook(() => useReviewCreditPosition());

    expect(result.current.credit).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("subscribes to the wallet's portfolio channel so deposits land live", async () => {
    stubFetch(POSITION);
    renderHook(() => useReviewCreditPosition());

    await waitFor(() =>
      expect(lastSubscription().channel).toBe(`portfolio:${ADDRESS}`)
    );
  });

  it("re-reads when the portfolio channel signals a deposit", async () => {
    const fetcher = stubFetch(POSITION, { ...POSITION, runsRemaining: 207 });
    const { result } = renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(result.current.credit).toEqual(POSITION));
    act(() => lastSubscription().handler());

    await waitFor(() => expect(result.current.credit?.runsRemaining).toBe(207));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("re-reads on an explicit refresh, for charges that signal nothing", async () => {
    const fetcher = stubFetch(POSITION, { ...POSITION, runsRemaining: 106 });
    const { result } = renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(result.current.credit).toEqual(POSITION));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.credit?.runsRemaining).toBe(106));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports a failed read as unknown rather than empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    const { result } = renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(result.current.credit).toBeNull());
  });

  it("drops a read that lands after unmount instead of setting state", async () => {
    let settle: (() => void) | undefined;
    const landed = new Promise<void>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          // Settles only once the test releases it, so the unmount happens
          // first and the read resolves against a dead render.
          await landed.then(
            () =>
              new Response(JSON.stringify(POSITION), {
                headers: { "content-type": "application/json" },
                status: 200,
              })
          )
      )
    );
    const { unmount } = renderHook(() => useReviewCreditPosition());

    unmount();
    settle?.();

    // A state update after unmount would surface as a React act warning; the
    // guard is what keeps this quiet.
    await expect(landed).resolves.toBeUndefined();
  });

  it("drops the previous wallet's position on disconnect", async () => {
    stubFetch(POSITION);
    const { rerender, result } = renderHook(() => useReviewCreditPosition());

    await waitFor(() => expect(result.current.credit).toEqual(POSITION));
    connectWallet(null);
    rerender();

    expect(result.current.credit).toBeNull();
  });
});
