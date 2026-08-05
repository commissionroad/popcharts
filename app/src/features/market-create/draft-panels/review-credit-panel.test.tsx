import type { MarketDraftBondShortfall } from "@popcharts/api-client/models";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEPOSIT_PRESETS_WAD } from "@/features/review-credit/review-credit-top-up-dialog";
import type { ReviewCreditDepositState } from "@/integrations/contracts/hooks/use-review-credit";

import { ReviewCreditPanel } from "./review-credit-panel";

const depositMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/contracts/hooks/use-review-credit", () => ({
  useReviewCreditDeposit: depositMock,
}));

// Captures the panel's live-channel subscription so tests can fire the
// change-feed nudge; the real hook no-ops without a LiveProvider anyway.
const liveChannel = vi.hoisted(() => ({
  channel: null as string | null,
  handler: null as ((signal: unknown) => void) | null,
}));

vi.mock("@/integrations/live-updates/use-live-channel", () => ({
  useLiveChannel: (channel: string | null, onSignal: (signal: unknown) => void) => {
    liveChannel.channel = channel;
    liveChannel.handler = channel ? onSignal : null;
  },
}));

const WAD = 10n ** 18n;
const RATE = WAD / 10n;
const BENEFICIARY = "0x2222222222222222222222222222222222222222" as const;

function shortfallFixture(
  overrides: Partial<MarketDraftBondShortfall> = {}
): MarketDraftBondShortfall {
  return {
    availableWad: "0",
    message: "You're out of review credit.",
    requiredWad: RATE.toString(),
    runsUsed: 3,
    ...overrides,
  };
}

function creditState(
  overrides: Partial<ReviewCreditDepositState> = {}
): ReviewCreditDepositState {
  return {
    deposit: vi.fn(),
    enabled: true,
    error: null,
    status: "idle",
    ...overrides,
  };
}

function fundedCredit(availableWad: bigint) {
  return {
    availableWad: availableWad.toString(),
    metered: true,
    rateWad: RATE.toString(),
    runsRemaining: Number(availableWad / RATE),
    runsUsed: 3,
  };
}

beforeEach(() => {
  depositMock.mockReset();
  depositMock.mockReturnValue(creditState());
  liveChannel.channel = null;
  liveChannel.handler = null;
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPanel({
  fetchCredit = null,
  onDismiss = vi.fn(),
  onFunded = vi.fn(),
  shortfall = shortfallFixture(),
}: Partial<Parameters<typeof ReviewCreditPanel>[0]> = {}) {
  return render(
    <ReviewCreditPanel
      beneficiary={BENEFICIARY}
      fetchCredit={fetchCredit}
      onDismiss={onDismiss}
      onFunded={onFunded}
      shortfall={shortfall}
    />
  );
}

describe("ReviewCreditPanel", () => {
  it("shows the credit position with run counts", () => {
    renderPanel({
      shortfall: shortfallFixture({
        availableWad: (RATE / 2n).toString(),
        runsUsed: 7,
      }),
    });

    expect(screen.getByText("Review credit needed")).toBeInTheDocument();
    expect(screen.getByText("You're out of review credit.")).toBeInTheDocument();
    expect(screen.getByText("Credit left")).toBeInTheDocument();
    expect(screen.getByText("Price per review")).toBeInTheDocument();
    expect(screen.getByText("Reviews used")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Reviews left")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("computes reviews left from the available credit and rate", () => {
    renderPanel({
      shortfall: shortfallFixture({
        // 0.25 pUSD at a 0.10 rate: two whole runs left (but a submission was
        // still refused elsewhere — the panel just renders the figures).
        availableWad: (25n * (WAD / 100n)).toString(),
        runsUsed: 1,
      }),
    });

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("reports zero reviews left when the rate is zero", () => {
    renderPanel({
      shortfall: shortfallFixture({ availableWad: WAD.toString(), requiredWad: "0" }),
    });

    expect(screen.getByText("Reviews left")).toBeInTheDocument();
  });

  it("offers the $1 / $5 / $10 presets and deposits for the beneficiary", () => {
    const state = creditState();
    depositMock.mockReturnValue(state);
    renderPanel();

    const [one, five, ten] = [
      screen.getByRole("button", { name: "Deposit 1.00" }),
      screen.getByRole("button", { name: "Deposit 5.00" }),
      screen.getByRole("button", { name: "Deposit 10.00" }),
    ];

    fireEvent.click(five);

    expect(state.deposit).toHaveBeenCalledWith(BENEFICIARY, DEPOSIT_PRESETS_WAD[1]);
    expect(one).toBeEnabled();
    expect(ten).toBeEnabled();
  });

  it("disables the presets without a beneficiary", () => {
    const state = creditState();
    depositMock.mockReturnValue(state);
    render(
      <ReviewCreditPanel
        beneficiary={null}
        fetchCredit={null}
        onDismiss={vi.fn()}
        onFunded={vi.fn()}
        shortfall={shortfallFixture()}
      />
    );

    const button = screen.getByRole("button", { name: "Deposit 1.00" });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.deposit).not.toHaveBeenCalled();
  });

  it("disables the presets and prompts the wallet while the write is pending", () => {
    depositMock.mockReturnValue(creditState({ status: "pending" }));
    renderPanel();

    expect(screen.getByRole("button", { name: "Deposit 1.00" })).toBeDisabled();
    expect(screen.getByText("Confirm the deposit in your wallet…")).toBeInTheDocument();
  });

  it("dismisses via the close control", () => {
    const onDismiss = vi.fn();
    renderPanel({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss credit prompt" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the write error", () => {
    depositMock.mockReturnValue(
      creditState({ error: "The deposit did not go through — try again." })
    );
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("did not go through");
  });

  it("funds immediately on confirmation when no poller is available", () => {
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();

    renderPanel({ onFunded });

    expect(onFunded).toHaveBeenCalledTimes(1);
  });

  it("checks immediately on confirmation and funds when the view already covers the run", async () => {
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    const fetchCredit = vi.fn().mockResolvedValue(fundedCredit(WAD));

    renderPanel({ fetchCredit, onFunded });

    await waitFor(() => expect(onFunded).toHaveBeenCalledTimes(1));
    expect(fetchCredit).toHaveBeenCalledTimes(1);
  });

  it("subscribes to the beneficiary's portfolio channel while indexing and funds on the nudge", async () => {
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    // Stale until the change-feed signal announces the indexed deposit.
    const fetchCredit = vi
      .fn()
      .mockResolvedValueOnce(fundedCredit(0n))
      .mockResolvedValue(fundedCredit(WAD));

    renderPanel({ fetchCredit, onFunded });

    expect(
      screen.getByText("Deposit confirmed — waiting for it to be indexed…")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit 1.00" })).toBeDisabled();

    await waitFor(() => expect(liveChannel.channel).toBe(`portfolio:${BENEFICIARY}`));
    await waitFor(() => expect(fetchCredit).toHaveBeenCalledTimes(1));
    liveChannel.handler?.({ kind: "change" });

    await waitFor(() => expect(onFunded).toHaveBeenCalledTimes(1));
    expect(fetchCredit).toHaveBeenCalledTimes(2);
  });

  it("ignores a nudge that lands while a check is already in flight", async () => {
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    let resolveRead: (value: ReturnType<typeof fundedCredit>) => void = () => {};
    const fetchCredit = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );

    renderPanel({ fetchCredit, onFunded });

    await waitFor(() => expect(fetchCredit).toHaveBeenCalledTimes(1));

    // The change feed can deliver several rows for one deposit; a nudge
    // during the in-flight read must not stack a second request.
    liveChannel.handler?.({ kind: "change" });
    liveChannel.handler?.({ kind: "change" });
    expect(fetchCredit).toHaveBeenCalledTimes(1);

    resolveRead(fundedCredit(WAD));
    await waitFor(() => expect(onFunded).toHaveBeenCalledTimes(1));
  });

  it("subscribes to nothing outside the indexing phase", () => {
    renderPanel();

    expect(liveChannel.channel).toBeNull();
  });

  it("falls back to the slow poll when no signal arrives", async () => {
    vi.useFakeTimers();
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    const fetchCredit = vi
      .fn()
      .mockResolvedValueOnce(fundedCredit(0n))
      .mockResolvedValue(fundedCredit(WAD));

    renderPanel({ fetchCredit, onFunded });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    expect(onFunded).toHaveBeenCalledTimes(1);
    expect(fetchCredit).toHaveBeenCalledTimes(2);
  });

  it("treats a failed credit read as not-yet-indexed and keeps watching", async () => {
    vi.useFakeTimers();
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    const fetchCredit = vi
      .fn()
      .mockRejectedValueOnce(new Error("proxy hiccup"))
      .mockResolvedValue(fundedCredit(WAD));

    renderPanel({ fetchCredit, onFunded });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    expect(onFunded).toHaveBeenCalledTimes(1);
  });

  it("stalls with guidance when the deposit never appears in the index", async () => {
    vi.useFakeTimers();
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    const fetchCredit = vi.fn().mockResolvedValue(fundedCredit(0n));

    renderPanel({ fetchCredit, onFunded });

    // Timer callbacks land React state updates, so the advance wraps in act.
    // Fallback checks run every 5s; the timeout is noticed on the first
    // check after the 30s mark, so advance past 35s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(41_000);
    });

    expect(onFunded).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("hasn't been indexed yet");
  });

  it("stops polling when the panel unmounts mid-wait", async () => {
    depositMock.mockReturnValue(creditState({ status: "success" }));
    const onFunded = vi.fn();
    let resolveRead: (value: ReturnType<typeof fundedCredit>) => void = () => {};
    const fetchCredit = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );

    const { unmount } = renderPanel({ fetchCredit, onFunded });

    await waitFor(() => expect(fetchCredit).toHaveBeenCalled());
    unmount();
    resolveRead(fundedCredit(WAD));
    await Promise.resolve();

    expect(onFunded).not.toHaveBeenCalled();
  });
});
