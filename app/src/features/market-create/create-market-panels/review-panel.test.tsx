import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";

import type { WalletCreateAction } from "../wallet-create-action";
import { ReviewPanel } from "./review-panel";

describe("ReviewPanel", () => {
  it("summarizes the draft's protocol parameters", () => {
    render(panel());

    expect(screen.getByText("Will it pop?")).toBeInTheDocument();
    expect(screen.getByText("Resolves YES if it pops.")).toBeInTheDocument();
    expect(screen.getByText("YES 50%")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();
    expect(screen.getByText("$2,500 matched market cap")).toBeInTheDocument();
    expect(screen.getByText("Assisted")).toBeInTheDocument();
    expect(screen.getByText(/^0x[0-9a-f]{8}/)).toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
    expect(screen.queryByText("URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Creation fee")).not.toBeInTheDocument();
  });

  it("lists resolution sources and url when the draft provides them", () => {
    render(
      panel({
        draft: draftFixture({
          resolutionSources: "CNN\nBBC",
          resolutionUrl: "https://example.com/feed",
        }),
      })
    );

    expect(screen.getByText("CNN, BBC")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/feed")).toBeInTheDocument();
  });

  it("marks AI resolution as bypassed and shows the fee when configured", () => {
    render(
      panel({
        creationFeeLabel: "1 native USDC",
        draft: draftFixture({ bypassAiResolution: true }),
      })
    );

    expect(screen.getByText("Bypassed")).toBeInTheDocument();
    expect(screen.getByText("Creation fee")).toBeInTheDocument();
    expect(screen.getByText("1 native USDC")).toBeInTheDocument();
  });

  it("surfaces submission errors", () => {
    render(panel({ submitError: "Reviewer queue is unavailable." }));

    expect(screen.getByText("Reviewer queue is unavailable.")).toBeInTheDocument();
  });

  it("shows wallet guidance and adopts the wallet action label", () => {
    render(
      panel({
        createAction: walletAction({
          disabled: true,
          label: "Sign in to create",
          message: "Sign in with your wallet before creating.",
        }),
      })
    );

    expect(
      screen.getByText("Sign in with your wallet before creating.")
    ).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Sign in to create/ })).toBeDisabled();
  });

  it("hides wallet guidance when the action has no message", () => {
    render(panel({ createAction: walletAction({ message: null }) }));

    expect(screen.getByRole("button", { name: /Create market/ })).toBeEnabled();
  });

  it("disables both actions while validation errors remain", () => {
    render(panel({ hasErrors: true }));

    expect(screen.getByRole("button", { name: /Submit for AI review/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Create market/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
  });

  it("labels the in-flight submission and creation states", () => {
    render(panel({ isCreating: true, isSubmittingForReview: true }));

    expect(screen.getByRole("button", { name: /Submitting\.\.\./ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Creating\.\.\./ })).toBeDisabled();
  });

  it("fires the submit, create, and edit callbacks", () => {
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onSubmitForReview = vi.fn();

    render(panel({ onCreate, onEdit, onSubmitForReview }));

    fireEvent.click(screen.getByRole("button", { name: /Submit for AI review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create market/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onSubmitForReview).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

function draftFixture(overrides: Partial<CreateMarketDraft> = {}): CreateMarketDraft {
  return {
    ...createInitialMarketDraft(new Date("2030-07-01T12:00:00.000Z")),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
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

function panel(
  overrides: Partial<Parameters<typeof ReviewPanel>[0]> & {
    draft?: CreateMarketDraft;
  } = {}
) {
  const { draft, ...panelOverrides } = overrides;

  return (
    <ReviewPanel
      createAction={null}
      creationFeeLabel={null}
      hasErrors={false}
      isCreating={false}
      isSubmittingForReview={false}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onSubmitForReview={vi.fn()}
      preview={buildCreateMarketPreview(draft ?? draftFixture())}
      submitError={null}
      {...panelOverrides}
    />
  );
}
