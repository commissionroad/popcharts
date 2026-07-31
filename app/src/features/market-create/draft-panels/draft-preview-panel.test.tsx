import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";

import { DraftPreviewPanel } from "./draft-preview-panel";

describe("DraftPreviewPanel", () => {
  it("mirrors an empty draft with placeholders and the review pitch", () => {
    render(panel({ draft: createInitialMarketDraft(new Date(INITIAL_NOW)) }));

    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(screen.getByText("Crypto")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Your question appears here")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();
    expect(
      screen.getByText(
        "An AI reviewer reads every draft before it can go live. It answers in seconds and tells you exactly what to fix."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the question and trimmed custom outcome labels", () => {
    render(
      panel({
        draft: draftFixture({ outcomeNo: " Egypt ", outcomeYes: " Argentina " }),
      })
    );

    expect(screen.getByText("Will it pop?")).toBeInTheDocument();
    expect(screen.getByText("Argentina")).toBeInTheDocument();
    expect(screen.getByText("Egypt")).toBeInTheDocument();
  });

  it("counts a single outstanding field error", () => {
    render(panel({ errorCount: 1 }));

    expect(screen.getByText("Fix 1 field to submit this draft.")).toBeInTheDocument();
  });

  it("counts multiple outstanding field errors", () => {
    render(panel({ errorCount: 3 }));

    expect(screen.getByText("Fix 3 fields to submit this draft.")).toBeInTheDocument();
  });

  it("labels and disables submission while it is in flight", () => {
    render(panel({ isSubmitting: true }));

    expect(screen.getByRole("button", { name: /Submitting…/ })).toBeDisabled();
  });

  it("fires the submit callback", () => {
    const onSubmit = vi.fn();

    render(panel({ onSubmit }));

    fireEvent.click(screen.getByRole("button", { name: /Submit for AI review/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("promises free iteration when drafts persist", () => {
    render(panel());

    expect(
      screen.getByText("Free while you iterate — pay only when you publish")
    ).toBeInTheDocument();
  });

  it("asks for a wallet when drafts cannot persist", () => {
    render(panel({ canPersist: false }));

    expect(
      screen.getByText("Connect a wallet to submit for review")
    ).toBeInTheDocument();
  });
});

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";

function draftFixture(overrides: Partial<CreateMarketDraft> = {}): CreateMarketDraft {
  return {
    ...createInitialMarketDraft(new Date(INITIAL_NOW)),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
    ...overrides,
  };
}

function panel(overrides: Partial<Parameters<typeof DraftPreviewPanel>[0]> = {}) {
  const draft = overrides.draft ?? draftFixture();

  return (
    <DraftPreviewPanel
      canPersist
      draft={draft}
      errorCount={0}
      isSubmitting={false}
      onSubmit={vi.fn()}
      preview={buildCreateMarketPreview(draft)}
      {...overrides}
    />
  );
}
