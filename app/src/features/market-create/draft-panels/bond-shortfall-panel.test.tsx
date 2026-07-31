import type { MarketDraftBondShortfall } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewBondState } from "@/integrations/contracts/hooks/use-review-bond";
import { useReviewBond } from "@/integrations/contracts/hooks/use-review-bond";

import { BondShortfallPanel, suggestedDepositWad } from "./bond-shortfall-panel";

vi.mock("@/integrations/contracts/hooks/use-review-bond", () => ({
  useReviewBond: vi.fn(),
}));

const WAD = 10n ** 18n;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useReviewBond).mockReturnValue(bondState());
});

describe("BondShortfallPanel", () => {
  it("shows the shortfall message, figures, and refundable-bond copy", () => {
    renderPanel();

    expect(screen.getByText("Review bond needed")).toBeInTheDocument();
    expect(
      screen.getByText("Your available bond doesn't cover this submission.")
    ).toBeInTheDocument();
    expect(screen.getByText("Bonded")).toBeInTheDocument();
    expect(screen.getByText("5.00 pUSD")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("0.10 pUSD")).toBeInTheDocument();
    expect(screen.getByText("This submission")).toBeInTheDocument();
    expect(screen.getByText("0.20 pUSD")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The bond is a prepaid, refundable balance — reviews meter against it, and you can withdraw the unused remainder anytime."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("One transaction — your draft resubmits automatically")
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses the prompt through the close control", () => {
    const onDismiss = vi.fn();
    renderPanel({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss bond prompt" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("deposits the suggested top-up in one click", () => {
    const bond = bondState();
    vi.mocked(useReviewBond).mockReturnValue(bond);
    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Deposit 0.10 pUSD & resubmit" })
    );

    expect(bond.deposit).toHaveBeenCalledTimes(1);
    expect(bond.deposit).toHaveBeenCalledWith(100_000_000_000_000_000n);
  });

  it("shows the depositing state while the transaction runs", () => {
    vi.mocked(useReviewBond).mockReturnValue(bondState({ status: "pending" }));
    renderPanel();

    expect(screen.getByRole("button", { name: "Depositing…" })).toBeDisabled();
  });

  it("disables the deposit until the bond hook is ready", () => {
    const bond = bondState({ enabled: false });
    vi.mocked(useReviewBond).mockReturnValue(bond);
    renderPanel();

    const button = screen.getByRole("button", {
      name: "Deposit 0.10 pUSD & resubmit",
    });

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(bond.deposit).not.toHaveBeenCalled();
  });

  it("disables the deposit when nothing more is owed", () => {
    renderPanel({
      shortfall: shortfallFixture({ availableWad: (WAD / 5n).toString() }),
    });

    expect(
      screen.getByRole("button", { name: "Deposit 0 pUSD & resubmit" })
    ).toBeDisabled();
  });

  it("surfaces the bond error as an alert", () => {
    vi.mocked(useReviewBond).mockReturnValue(
      bondState({ error: "Request cancelled in your wallet." })
    );
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Request cancelled in your wallet."
    );
  });

  it("notifies the parent exactly once when the deposit confirms", () => {
    const onFunded = vi.fn();
    const view = renderPanel({ onFunded });

    expect(onFunded).not.toHaveBeenCalled();

    vi.mocked(useReviewBond).mockReturnValue(bondState({ status: "success" }));
    view.rerenderPanel();

    expect(onFunded).toHaveBeenCalledTimes(1);

    // A later status round-trip (refresh, second attempt) must not re-notify.
    vi.mocked(useReviewBond).mockReturnValue(bondState({ status: "idle" }));
    view.rerenderPanel();
    vi.mocked(useReviewBond).mockReturnValue(bondState({ status: "success" }));
    view.rerenderPanel();

    expect(onFunded).toHaveBeenCalledTimes(1);
  });
});

describe("suggestedDepositWad", () => {
  it("tops up to the standing-bond floor when that gap is largest", () => {
    expect(
      suggestedDepositWad(
        shortfallFixture({
          availableWad: "0",
          requiredWad: WAD.toString(),
          standingBondWad: "0",
        })
      )
    ).toBe(5n * WAD);
  });

  it("covers the queued charge when that gap is largest", () => {
    expect(
      suggestedDepositWad(
        shortfallFixture({
          availableWad: "0",
          requiredWad: WAD.toString(),
          standingBondWad: (4n * WAD + 900_000_000_000_000_000n).toString(),
        })
      )
    ).toBe(WAD);
  });

  it("suggests nothing when both gaps are closed", () => {
    expect(
      suggestedDepositWad(
        shortfallFixture({
          availableWad: (2n * WAD).toString(),
          requiredWad: WAD.toString(),
          standingBondWad: (6n * WAD).toString(),
        })
      )
    ).toBe(0n);
  });
});

// The $5-bonded, $0.10-available, $0.20-required top-up case: the suggested
// deposit is the 0.10 pUSD charge gap.
function shortfallFixture(
  overrides: Partial<MarketDraftBondShortfall> = {}
): MarketDraftBondShortfall {
  return {
    availableWad: (WAD / 10n).toString(),
    message: "Your available bond doesn't cover this submission.",
    minimumStandingBondWad: (5n * WAD).toString(),
    requiredWad: (WAD / 5n).toString(),
    standingBondWad: (5n * WAD).toString(),
    ...overrides,
  };
}

function bondState(overrides: Partial<ReviewBondState> = {}): ReviewBondState {
  return {
    availableWad: WAD / 10n,
    deposit: vi.fn(),
    depositedWad: 5n * WAD,
    enabled: true,
    error: null,
    refresh: vi.fn(),
    status: "idle",
    withdraw: vi.fn(),
    ...overrides,
  };
}

function renderPanel({
  onDismiss = vi.fn(),
  onFunded = vi.fn(),
  shortfall = shortfallFixture(),
}: {
  onDismiss?: () => void;
  onFunded?: () => void;
  shortfall?: MarketDraftBondShortfall;
} = {}) {
  const view = render(
    <BondShortfallPanel
      onDismiss={onDismiss}
      onFunded={onFunded}
      shortfall={shortfall}
    />
  );

  return {
    ...view,
    rerenderPanel: () =>
      view.rerender(
        <BondShortfallPanel
          onDismiss={onDismiss}
          onFunded={onFunded}
          shortfall={shortfall}
        />
      ),
  };
}
