import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";

import type { SubmittedMarketReview } from "../create-market-service";
import type { WalletCreateAction } from "../wallet-create-action";
import { SubmittedPanel } from "./submitted-panel";

describe("SubmittedPanel", () => {
  it("shows the queued review ticket and submission details", () => {
    render(panel());

    expect(screen.getByText("Submitted for AI review")).toBeInTheDocument();
    expect(screen.getByText("review-test-123")).toBeInTheDocument();
    expect(screen.getByText("Eligible")).toBeInTheDocument();
    expect(screen.getByText("Will it pop?")).toBeInTheDocument();
    expect(screen.getByText(/^0x[0-9a-f]{8}/)).toBeInTheDocument();
    // Local-zone timestamp; assert the stable date part.
    expect(screen.getByText(/Jun 22, 2026/)).toBeInTheDocument();
  });

  it("labels webhook-forwarded reviews", () => {
    render(
      panel({
        result: reviewFixture({
          aiReview: { source: "webhook", status: "forwarded" },
        }),
      })
    );

    expect(screen.getByText("Forwarded to reviewer")).toBeInTheDocument();
  });

  it("surfaces submission errors", () => {
    render(panel({ submitError: "Reviewer queue is unavailable." }));

    expect(screen.getByText("Reviewer queue is unavailable.")).toBeInTheDocument();
  });

  it("shows wallet guidance and disables creation when the wallet blocks it", () => {
    render(
      panel({
        createAction: walletAction({
          disabled: true,
          label: "Switch chain",
          message: "Switch your wallet to the devchain.",
        }),
      })
    );

    expect(screen.getByText("Switch your wallet to the devchain.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch chain/ })).toBeDisabled();
  });

  it("hides wallet guidance when the action has no message", () => {
    render(panel({ createAction: walletAction({ message: null }) }));

    expect(screen.getByRole("button", { name: /Create market/ })).toBeEnabled();
  });

  it("labels the in-flight creation state", () => {
    render(panel({ isCreating: true }));

    expect(screen.getByRole("button", { name: /Creating\.\.\./ })).toBeDisabled();
  });

  it("fires the create and edit callbacks", () => {
    const onCreate = vi.fn();
    const onEdit = vi.fn();

    render(panel({ onCreate, onEdit }));

    fireEvent.click(screen.getByRole("button", { name: /Create market/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

function reviewFixture(
  overrides: Partial<SubmittedMarketReview> = {}
): SubmittedMarketReview {
  const draft = {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
  };

  return {
    ...buildCreateMarketPreview(draft),
    aiReview: { source: "local", status: "eligible" },
    reviewId: "review-test-123",
    reviewStatus: "queued",
    submittedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  };
}

function walletAction(overrides: Partial<WalletCreateAction> = {}): WalletCreateAction {
  return {
    disabled: false,
    kind: "ready",
    label: "Create market",
    message: null,
    run: vi.fn(),
    ...overrides,
  };
}

function panel(overrides: Partial<Parameters<typeof SubmittedPanel>[0]> = {}) {
  return (
    <SubmittedPanel
      createAction={null}
      isCreating={false}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      result={reviewFixture()}
      submitError={null}
      {...overrides}
    />
  );
}
