import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import { useMarketDisputeState } from "@/integrations/contracts/hooks/use-market-dispute-state";
import type { MarketDisputeSnapshot } from "@/integrations/contracts/market-dispute-state";
import { marketFactory } from "@/test/factories/markets";

import { MarketResolutionPanel } from "./market-resolution-panel";
import {
  settleMarketAction,
  type SettleMarketActionResult,
} from "./resolution-actions";

vi.mock("@/integrations/contracts/hooks/use-market-dispute-state", () => ({
  useMarketDisputeState: vi.fn(),
}));
vi.mock("./resolution-actions", () => ({ settleMarketAction: vi.fn() }));

// Both action surfaces are covered on their own, in
// `market-dispute-action.test.tsx` and `market-settle-action.test.tsx`.
// Stubbing them here keeps these tests about what the panel decides: which
// surface a given chain state reaches, and what it does with the settle answer.
vi.mock("./market-dispute-action", () => ({
  MarketDisputeAction: ({
    remainingMs,
    snapshot,
  }: {
    remainingMs: number;
    snapshot: MarketDisputeSnapshot;
  }) => (
    <p>
      dispute {snapshot.phase} {remainingMs}
    </p>
  ),
}));
vi.mock("./market-settle-action", () => ({
  MarketSettleAction: ({
    onSettle,
    outcome,
    pending,
    proposedLabel,
  }: {
    onSettle: () => void;
    outcome: SettleMarketActionResult | null;
    pending: boolean;
    proposedLabel: string;
  }) => (
    <div>
      <p>settle {proposedLabel}</p>
      <p>outcome: {outcome ? JSON.stringify(outcome) : "none"}</p>
      <p>pending: {String(pending)}</p>
      <button onClick={onSettle} type="button">
        settle this market
      </button>
    </div>
  ),
}));

const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET_ADDRESS = "0x2222222222222222222222222222222222222222";
const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.mocked(useMarketDisputeState).mockReturnValue({
    error: null,
    loading: false,
    snapshot: snapshotFixture(),
  });
  vi.mocked(settleMarketAction).mockResolvedValue({ status: "settled" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarketResolutionPanel", () => {
  it("renders nothing when the market has no postgrad contract", () => {
    const { postgrad: _postgrad, ...withoutPostgrad } = graduatedMarket();

    const { container } = render(<MarketResolutionPanel market={withoutPostgrad} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["no dispute window is open", false, snapshotFixture({ phase: "none" })],
    ["the on-chain read is still in flight", true, null],
  ])("renders nothing when %s", (_label, loading, snapshot) => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading,
      snapshot,
    });

    const { container } = render(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a failed on-chain read instead of silently rendering nothing", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: "Could not read this market's resolution status.",
      loading: false,
      snapshot: null,
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(screen.getByText("Resolution status unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Could not read this market's resolution status.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A dispute window may be open on this market/)
    ).toBeInTheDocument();
  });

  it("re-reads the chain when a failed read is retried", () => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: "Network problem reaching the chain. Check your connection and try again.",
      loading: false,
      snapshot: null,
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(useMarketDisputeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshKey: 1 })
    );
  });

  it("offers disputing while the window is open, with the time left", () => {
    render(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(screen.getByText("dispute pending 3665000")).toBeInTheDocument();
    expect(screen.queryByText(/^settle/)).not.toBeInTheDocument();
  });

  it("counts down once a second and offers settlement when the window closes", () => {
    const setInterval = vi.spyOn(window, "setInterval");
    render(<MarketResolutionPanel market={graduatedMarket()} />);

    const tick = setInterval.mock.calls[0]?.[0] as () => void;
    vi.mocked(Date.now).mockReturnValue(NOW + 3_665_000);
    act(() => {
      tick();
    });

    expect(screen.getByText("settle YES")).toBeInTheDocument();
    // Disputing is over, so the bonded action must not still be on offer.
    expect(screen.queryByText(/^dispute /)).not.toBeInTheDocument();
  });

  it("keeps a disputed market on the dispute surface after its window closes", () => {
    // Only an operator settles a disputed market, so the public settle press
    // must never appear here — the endpoint would refuse it anyway.
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({
        deadline: (NOW - 1_000) / 1_000,
        phase: "disputed",
      }),
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(screen.getByText("dispute disputed 0")).toBeInTheDocument();
    expect(screen.queryByText(/^settle/)).not.toBeInTheDocument();
  });
});

// The window has closed but the contract still says pending. The keeper finds
// pending markets through the indexed status, so the one way a person reaches
// this state is that the keeper does not know the market is here. Settling is
// the recovery, and the server makes the permissionless call on their behalf.
describe("MarketResolutionPanel settlement", () => {
  beforeEach(() => {
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ deadline: (NOW - 1_000) / 1_000 }),
    });
  });

  it("asks the server to settle, naming the market by its app id", async () => {
    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(settleMarketAction).toHaveBeenCalledWith("eth-5000-august")
    );
  });

  it("re-reads the chain once the settlement lands", async () => {
    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(useMarketDisputeState).toHaveBeenLastCalledWith(
        expect.objectContaining({ refreshKey: 1 })
      )
    );
  });

  it("keeps the confirmation after the contract reads back as resolved", async () => {
    const { rerender } = render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"status":"settled"/)).toBeInTheDocument()
    );

    // What the very next on-chain read reports once the market settles.
    // Without the branch ahead of the phase check, this blanks the panel out
    // from under the person who just pressed.
    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: null,
      loading: false,
      snapshot: snapshotFixture({ phase: "none" }),
    });
    rerender(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(screen.getByText(/"status":"settled"/)).toBeInTheDocument();
  });

  it("keeps the confirmation when the follow-up chain read fails", async () => {
    const { rerender } = render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"status":"settled"/)).toBeInTheDocument()
    );

    vi.mocked(useMarketDisputeState).mockReturnValue({
      error: "Could not read this market's resolution status.",
      loading: false,
      snapshot: null,
    });
    rerender(<MarketResolutionPanel market={graduatedMarket()} />);

    expect(screen.getByText(/"status":"settled"/)).toBeInTheDocument();
    expect(screen.queryByText("Resolution status unavailable")).not.toBeInTheDocument();
  });

  it("marks the settle surface pending while the request is in flight", async () => {
    let land: (result: SettleMarketActionResult) => void = () => {};
    vi.mocked(settleMarketAction).mockReturnValue(
      new Promise<SettleMarketActionResult>((resolve) => {
        land = resolve;
      })
    );

    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() => expect(screen.getByText("pending: true")).toBeInTheDocument());

    await act(async () => {
      land({ status: "settled" });
    });

    expect(screen.getByText("pending: false")).toBeInTheDocument();
  });

  it("hands a refusal down without re-reading the chain", async () => {
    vi.mocked(settleMarketAction).mockResolvedValue({
      reason: "already_resolved",
      status: "refused",
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"reason":"already_resolved"/)).toBeInTheDocument()
    );
    // Losing the race is an answer, and the copy explaining it is the useful
    // thing on screen; a re-read would replace it with whatever state won.
    expect(useMarketDisputeState).not.toHaveBeenCalledWith(
      expect.objectContaining({ refreshKey: 1 })
    );
  });

  it("hands a failure down without re-reading the chain", async () => {
    vi.mocked(settleMarketAction).mockResolvedValue({
      message: "Could not settle this market.",
      status: "error",
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"status":"error"/)).toBeInTheDocument()
    );
    expect(useMarketDisputeState).not.toHaveBeenCalledWith(
      expect.objectContaining({ refreshKey: 1 })
    );
  });

  it("clears the previous answer when the viewer presses again", async () => {
    vi.mocked(settleMarketAction).mockResolvedValue({
      reason: "window_open",
      status: "refused",
    });

    render(<MarketResolutionPanel market={graduatedMarket()} />);
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"reason":"window_open"/)).toBeInTheDocument()
    );

    vi.mocked(settleMarketAction).mockResolvedValue({ status: "settled" });
    fireEvent.click(screen.getByRole("button", { name: "settle this market" }));

    await waitFor(() =>
      expect(screen.getByText(/"status":"settled"/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/window_open/)).not.toBeInTheDocument();
  });
});

function snapshotFixture(
  overrides: Partial<MarketDisputeSnapshot> = {}
): MarketDisputeSnapshot {
  return {
    bond: 100n * 10n ** 18n,
    bondHeld: 0n,
    collateralDecimals: 18,
    // 1h 01m 05s after the frozen `now`.
    deadline: (NOW + 3_665_000) / 1_000,
    disputer: null,
    phase: "pending",
    proposedSide: "yes",
    resolver: RESOLVER,
    ...overrides,
  };
}

function graduatedMarket(): Market {
  return marketFactory({
    postgrad: {
      adapterAddress: "0x9999999999999999999999999999999999999999",
      completeSets: 1_000,
      finalizedAt: "2026-07-24T00:00:00.000Z",
      marketAddress: MARKET_ADDRESS,
      refundedUsd: 0,
      retainedUsd: 0,
    },
    status: "graduated",
  });
}
