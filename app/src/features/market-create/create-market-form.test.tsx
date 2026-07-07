import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";

import { CreateMarketForm } from "./create-market-form";
import type { SubmittedMarketReview } from "./create-market-service";
import type { useCreateMarketFormState } from "./use-create-market-form-state";

const useFormState = vi.hoisted(() => vi.fn());

vi.mock("./use-create-market-form-state", () => ({
  useCreateMarketFormState: useFormState,
}));

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";

beforeEach(() => {
  useFormState.mockReset();
});

describe("CreateMarketForm", () => {
  it("shows the live preview sidebar while editing", () => {
    stubState();

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(useFormState).toHaveBeenCalledWith(INITIAL_NOW);
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(screen.queryByText("Submit for AI review")).not.toBeInTheDocument();
  });

  it("routes field edits through updateDraft", () => {
    const state = stubState();

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.change(screen.getByLabelText(/Market question/), {
      target: { value: "Will it pop twice?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Politics" }));
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Context." },
    });
    fireEvent.change(screen.getByLabelText(/Resolution criteria/), {
      target: { value: "Resolves YES if it pops twice." },
    });
    fireEvent.change(screen.getByLabelText(/Resolution sources/), {
      target: { value: "CNN" },
    });
    fireEvent.change(screen.getByLabelText(/YES label/), {
      target: { value: "Argentina" },
    });
    fireEvent.change(screen.getByLabelText(/NO label/), {
      target: { value: "Egypt" },
    });
    fireEvent.change(screen.getByLabelText("Opening YES probability"), {
      target: { value: "64" },
    });

    expect(state.updateDraft).toHaveBeenCalledWith("question", "Will it pop twice?");
    expect(state.updateDraft).toHaveBeenCalledWith("outcomeYes", "Argentina");
    expect(state.updateDraft).toHaveBeenCalledWith("outcomeNo", "Egypt");
    expect(state.updateDraft).toHaveBeenCalledWith("category", "Politics");
    expect(state.updateDraft).toHaveBeenCalledWith("description", "Context.");
    expect(state.updateDraft).toHaveBeenCalledWith(
      "resolutionCriteria",
      "Resolves YES if it pops twice."
    );
    expect(state.updateDraft).toHaveBeenCalledWith("resolutionSources", "CNN");
    expect(state.updateDraft).toHaveBeenCalledWith("openingProbability", 64);
  });

  it("renders visible field errors", () => {
    stubState({ visibleErrors: { question: "Add a market question." } });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Add a market question.")).toBeInTheDocument();
  });

  it("applies deadline edits and presets to the draft", () => {
    const state = stubState();

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.change(screen.getByLabelText(/Graduation deadline/), {
      target: { value: "2030-08-01T09:30" },
    });
    fireEvent.change(screen.getByLabelText(/Resolution deadline/), {
      target: { value: "2030-09-01T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    fireEvent.click(screen.getByRole("button", { name: "1w" }));

    expect(state.updateDraftWith).toHaveBeenCalledTimes(2);
    expect(state.applyGraduationPreset).toHaveBeenCalledWith(GRADUATION_PRESETS[1]);
    expect(state.applyResolutionPreset).toHaveBeenCalledWith(RESOLUTION_PRESETS[1]);
  });

  it("keeps the advanced section collapsed until toggled", () => {
    const state = stubState();

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.queryByText("Liquidity parameter b")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(state.toggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it("exposes the liquidity controls when advanced is open", () => {
    const state = stubState({ advanced: true });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.getByText("b impact")).toBeInTheDocument();
    expect(screen.getByLabelText(/Collateral token/)).toHaveValue("pUSD");
    expect(screen.getByLabelText(/Graduation target/)).toHaveValue("$2,500 matched");
    expect(screen.queryByText("AI resolution bypass")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Virtual LMSR liquidity parameter b"), {
      target: { value: "3000" },
    });

    expect(state.updateDraft).toHaveBeenCalledWith("liquidityParameter", 3000);
  });

  it("offers the AI-resolution bypass to trusted creators", () => {
    const state = stubState({
      advanced: true,
      trustedCreatorCanBypassAiResolution: true,
    });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(state.updateDraft).toHaveBeenCalledWith("bypassAiResolution", true);
  });

  it("advances to review from the live preview", () => {
    const state = stubState();

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /Review market/ }));

    expect(state.handleReview).toHaveBeenCalledTimes(1);
  });

  it("shows the review panel and wires its actions", () => {
    const state = stubState({ stage: "review" });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /Submit for AI review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create market/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(state.handleSubmitForReview).toHaveBeenCalledTimes(1);
    expect(state.handleCreate).toHaveBeenCalledTimes(1);
    expect(state.returnToEdit).toHaveBeenCalledTimes(1);
  });

  it("shows the submitted panel once a review ticket exists", () => {
    stubState({ stage: "submitted", submittedReview: submittedReviewFixture() });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Submitted for AI review")).toBeInTheDocument();
  });

  it("falls back to the live preview when the submitted ticket is missing", () => {
    stubState({ stage: "submitted", submittedReview: null });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Live preview")).toBeInTheDocument();
  });

  it("shows the success panel and resets from it", () => {
    const state = stubState({
      createdMarket: createdMarketFixture(),
      stage: "success",
    });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /Create another/ }));

    expect(state.resetForm).toHaveBeenCalledTimes(1);
  });

  it("falls back to the live preview when the created market is missing", () => {
    stubState({ createdMarket: null, stage: "success" });

    render(<CreateMarketForm initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Live preview")).toBeInTheDocument();
  });
});

type FormState = ReturnType<typeof useCreateMarketFormState>;

function draftFixture(): CreateMarketDraft {
  return {
    ...createInitialMarketDraft(new Date(INITIAL_NOW)),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
  };
}

function submittedReviewFixture(): SubmittedMarketReview {
  return {
    ...buildCreateMarketPreview(draftFixture()),
    aiReview: { source: "local", status: "eligible" },
    reviewId: "review-test-123",
    reviewStatus: "queued",
    submittedAt: "2026-06-22T12:00:00.000Z",
  };
}

function createdMarketFixture(): FormState["createdMarket"] {
  return {
    ...buildCreateMarketPreview(draftFixture()),
    creationMode: "mock",
    marketId: "draft-abc123",
  };
}

function stubState(overrides: Partial<FormState> = {}): FormState {
  const draft = draftFixture();
  const state: FormState = {
    advanced: false,
    createAction: null,
    createdMarket: null,
    creationFeeLabel: null,
    draft,
    hasErrors: false,
    isCreating: false,
    isSubmittingForReview: false,
    preview: buildCreateMarketPreview(draft),
    reviewErrorCount: 0,
    stage: "edit",
    submitError: null,
    submittedReview: null,
    trustedCreatorCanBypassAiResolution: false,
    visibleErrors: {},
    applyGraduationPreset: vi.fn(),
    applyResolutionPreset: vi.fn(),
    handleCreate: vi.fn(),
    handleReview: vi.fn(),
    handleSubmitForReview: vi.fn(),
    resetForm: vi.fn(),
    returnToEdit: vi.fn(),
    toggleAdvanced: vi.fn(),
    updateDraft: vi.fn(),
    updateDraftWith: vi.fn((updater) => updater(draftFixture())),
    ...overrides,
  };

  useFormState.mockReturnValue(state);

  return state;
}
