import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";

import { LivePreviewPanel } from "./live-preview-panel";

describe("LivePreviewPanel", () => {
  it("mirrors the draft question, prices, and target in the live card", () => {
    render(panel({ draft: draftFixture({ openingProbability: 64 }) }));

    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(screen.getByText("Will it pop?")).toBeInTheDocument();
    expect(screen.getByText("Crypto")).toBeInTheDocument();
    expect(screen.getByText("64c")).toBeInTheDocument();
    expect(screen.getByText("36c")).toBeInTheDocument();
    expect(screen.getByText("$2,500")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();
    expect(screen.getByText("No seed capital required")).toBeInTheDocument();
  });

  it("shows placeholder copy while the question is empty", () => {
    render(panel({ draft: draftFixture({ question: "" }) }));

    expect(screen.getByText("Your question appears here")).toBeInTheDocument();
  });

  it("omits the error prompt when nothing blocks review", () => {
    render(panel({ reviewErrorCount: 0 }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prompts for a single outstanding field in the singular", () => {
    render(panel({ reviewErrorCount: 1 }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fix 1 field to review this market."
    );
  });

  it("prompts for multiple outstanding fields in the plural", () => {
    render(panel({ reviewErrorCount: 3 }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Fix 3 fields to review this market."
    );
  });

  it("advances to review when the button is clicked", () => {
    const onReview = vi.fn();

    render(panel({ onReview }));

    fireEvent.click(screen.getByRole("button", { name: /Review market/ }));

    expect(onReview).toHaveBeenCalledTimes(1);
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

function panel(overrides: Partial<Parameters<typeof LivePreviewPanel>[0]> = {}) {
  const draft = overrides.draft ?? draftFixture();

  return (
    <LivePreviewPanel
      draft={draft}
      onReview={vi.fn()}
      preview={buildCreateMarketPreview(draft)}
      reviewErrorCount={0}
      {...overrides}
    />
  );
}
