import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewCreditDepositState } from "@/integrations/contracts/hooks/use-review-credit";
import { useReviewCreditDeposit } from "@/integrations/contracts/hooks/use-review-credit";

import {
  DEPOSIT_PRESETS_WAD,
  ReviewCreditTopUpDialog,
} from "./review-credit-top-up-dialog";

vi.mock("@/integrations/contracts/hooks/use-review-credit", () => ({
  useReviewCreditDeposit: vi.fn(),
}));

const BENEFICIARY = "0x1111111111111111111111111111111111111111";

function depositState(
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

function open(overrides: Parameters<typeof ReviewCreditTopUpDialog>[0] | object = {}) {
  return render(
    <ReviewCreditTopUpDialog
      beneficiary={BENEFICIARY}
      onClose={() => undefined}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.mocked(useReviewCreditDeposit).mockReturnValue(depositState());
});

describe("ReviewCreditTopUpDialog", () => {
  it("keeps crediting the account it opened with when the wallet switches", () => {
    // Credit is non-refundable and immovable, so the account on screen must
    // be the account paid — for the whole life of the dialog, including
    // mid-deposit. A live prop would move the beneficiary under the creator.
    const state = depositState();
    vi.mocked(useReviewCreditDeposit).mockReturnValue(state);
    const { rerender } = open();

    rerender(
      <ReviewCreditTopUpDialog
        beneficiary="0x2222222222222222222222222222222222222222"
        onClose={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Deposit 1.00" }));

    expect(screen.getByText(BENEFICIARY)).toBeInTheDocument();
    expect(state.deposit).toHaveBeenCalledWith(BENEFICIARY, DEPOSIT_PRESETS_WAD[0]);
  });

  it("refuses to close while the deposit is in flight", () => {
    // Closing would leave the write running with nowhere to report success
    // or failure.
    vi.mocked(useReviewCreditDeposit).mockReturnValue(
      depositState({ status: "pending" })
    );
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close top-up dialog" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("presentation"));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close top-up dialog" })).toBeDisabled();
  });

  it("is a labelled modal dialog", () => {
    open();
    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Top up review credit")).toBeInTheDocument();
  });

  it("names the account a deposit will credit", () => {
    open();

    expect(screen.getByText(BENEFICIARY)).toBeInTheDocument();
  });

  it("says credit is non-refundable before any money moves", () => {
    open();

    expect(screen.getByText(/non-refundable/)).toBeInTheDocument();
  });

  it("deposits the chosen preset for the beneficiary", () => {
    const state = depositState();
    vi.mocked(useReviewCreditDeposit).mockReturnValue(state);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Deposit 5.00" }));

    expect(state.deposit).toHaveBeenCalledWith(BENEFICIARY, DEPOSIT_PRESETS_WAD[1]);
  });

  it("disables the presets without a beneficiary", () => {
    open({ beneficiary: null });

    expect(screen.getByRole("button", { name: "Deposit 1.00" })).toBeDisabled();
  });

  it("disables the presets when no vault or wallet is available", () => {
    vi.mocked(useReviewCreditDeposit).mockReturnValue(depositState({ enabled: false }));
    open();

    expect(screen.getByRole("button", { name: "Deposit 1.00" })).toBeDisabled();
  });

  it("locks the presets while a deposit is in flight", () => {
    vi.mocked(useReviewCreditDeposit).mockReturnValue(
      depositState({ status: "pending" })
    );
    open();

    expect(screen.getByRole("button", { name: "Deposit 1.00" })).toBeDisabled();
    expect(screen.getByText("Confirm the deposit in your wallet…")).toBeInTheDocument();
  });

  it("hands off to the card's own re-read once the deposit confirms", () => {
    vi.mocked(useReviewCreditDeposit).mockReturnValue(
      depositState({ status: "success" })
    );
    open();

    expect(
      screen.getByText("Deposit confirmed — your balance updates once it's indexed.")
    ).toBeInTheDocument();
  });

  it("surfaces a failed deposit as an alert", () => {
    vi.mocked(useReviewCreditDeposit).mockReturnValue(
      depositState({
        error: "The deposit did not go through — try again.",
        status: "error",
      })
    );
    open();

    expect(screen.getByRole("alert")).toHaveTextContent("did not go through");
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close top-up dialog" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a backdrop click", () => {
    const onClose = vi.fn();
    open({ onClose });

    // The backdrop is the dialog's parent; clicking it directly is what a
    // click outside the panel produces.
    fireEvent.click(screen.getByRole("presentation"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open when the click landed inside the panel", () => {
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.click(screen.getByRole("dialog"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open", () => {
    open();

    expect(screen.getByRole("button", { name: "Close top-up dialog" })).toHaveFocus();
  });

  it("wraps focus forward at the last control", () => {
    open();
    const buttons = screen.getAllByRole("button");
    const last = buttons.at(-1) as HTMLElement;
    const first = buttons[0] as HTMLElement;
    last.focus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });

    expect(first).toHaveFocus();
  });

  it("wraps focus backward at the first control", () => {
    open();
    const buttons = screen.getAllByRole("button");
    const last = buttons.at(-1) as HTMLElement;
    const first = buttons[0] as HTMLElement;
    first.focus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });

    expect(last).toHaveFocus();
  });

  it("leaves Tab alone in the middle of the dialog", () => {
    open();
    const middle = screen.getByRole("button", { name: "Deposit 1.00" });
    middle.focus();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });

    expect(middle).toHaveFocus();
  });

  it("does not crash on Tab when the panel holds nothing focusable", () => {
    const onClose = vi.fn();
    open({ onClose });
    const dialog = screen.getByRole("dialog");
    // The rendered panel always has a close button, so this state is only
    // reachable by emptying it — which is exactly what the guard defends
    // against, and worth proving is a no-op rather than a throw.
    for (const button of dialog.querySelectorAll("button")) {
      button.remove();
    }

    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores keys that are neither Escape nor Tab", () => {
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns focus to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = open();
    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
