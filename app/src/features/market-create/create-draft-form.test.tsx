import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";
import { draftFeedbackItemFactory } from "@/test/factories/drafts";

import { CreateDraftForm } from "./create-draft-form";
import type { useCreateDraftFlow } from "./use-create-draft-flow";
import type { WalletCreateAction } from "./wallet-create-action";

describe("CreateDraftForm", () => {
  it("routes field edits through updateDraft", () => {
    const flow = stubFlow();

    render(<CreateDraftForm flow={flow} />);

    fireEvent.change(screen.getByLabelText(/Market question/), {
      target: { value: "Will it pop twice?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Politics" }));
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Context." },
    });
    fireEvent.change(screen.getByLabelText(/YES label/), {
      target: { value: "Argentina" },
    });
    fireEvent.change(screen.getByLabelText(/NO label/), {
      target: { value: "Egypt" },
    });
    fireEvent.change(screen.getByLabelText(/Resolution criteria/), {
      target: { value: "Resolves YES if it pops twice." },
    });
    fireEvent.change(screen.getByLabelText(/Resolution sources/), {
      target: { value: "CNN" },
    });
    fireEvent.change(screen.getByLabelText("Opening YES probability"), {
      target: { value: "64" },
    });

    expect(flow.updateDraft).toHaveBeenCalledWith("question", "Will it pop twice?");
    expect(flow.updateDraft).toHaveBeenCalledWith("category", "Politics");
    expect(flow.updateDraft).toHaveBeenCalledWith("description", "Context.");
    expect(flow.updateDraft).toHaveBeenCalledWith("outcomeYes", "Argentina");
    expect(flow.updateDraft).toHaveBeenCalledWith("outcomeNo", "Egypt");
    expect(flow.updateDraft).toHaveBeenCalledWith(
      "resolutionCriteria",
      "Resolves YES if it pops twice."
    );
    expect(flow.updateDraft).toHaveBeenCalledWith("resolutionSources", "CNN");
    expect(flow.updateDraft).toHaveBeenCalledWith("openingProbability", 64);
  });

  it("applies deadline edits and presets to the draft", () => {
    const flow = stubFlow();

    render(<CreateDraftForm flow={flow} />);

    fireEvent.change(screen.getByLabelText(/Graduation deadline/), {
      target: { value: "2030-08-01T09:30" },
    });
    fireEvent.change(screen.getByLabelText(/Resolution deadline/), {
      target: { value: "2030-09-01T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    fireEvent.click(screen.getByRole("button", { name: "1w" }));

    expect(flow.updateDraftWith).toHaveBeenCalledTimes(2);
    expect(flow.applyGraduationPreset).toHaveBeenCalledWith(GRADUATION_PRESETS[1]);
    expect(flow.applyResolutionPreset).toHaveBeenCalledWith(RESOLUTION_PRESETS[1]);
  });

  it("renders visible field errors", () => {
    render(
      <CreateDraftForm
        flow={stubFlow({ visibleErrors: { question: "Add a market question." } })}
      />
    );

    expect(screen.getByText("Add a market question.")).toBeInTheDocument();
  });

  it("stays interactive while unlocked", () => {
    const { container } = render(<CreateDraftForm flow={stubFlow()} />);

    expect(container.querySelector("section")).not.toHaveAttribute("aria-disabled");
  });

  it("locks the form while a review runs", () => {
    const { container } = render(
      <CreateDraftForm flow={stubFlow({ formLocked: true })} />
    );

    const section = container.querySelector("section");

    expect(section).toHaveAttribute("aria-disabled", "true");
    expect(section).toHaveAttribute("inert");
  });

  it("renders field-anchored feedback under the fields it concerns", () => {
    render(
      <CreateDraftForm
        flow={stubFlow({
          fieldFeedback: {
            description: [],
            question: [
              draftFeedbackItemFactory({ title: "Phrase it as a yes/no question" }),
            ],
            resolutionCriteria: [
              draftFeedbackItemFactory({
                field: "resolutionCriteria",
                title: "Pin down the deadline",
              }),
            ],
            resolutionSources: [
              draftFeedbackItemFactory({
                field: "resolutionSources",
                title: "Name a public source",
              }),
            ],
          },
        })}
      />
    );

    expect(screen.getByText("Phrase it as a yes/no question")).toBeInTheDocument();
    expect(screen.getByText("Pin down the deadline")).toBeInTheDocument();
    expect(screen.getByText("Name a public source")).toBeInTheDocument();
    expect(
      screen.queryByText("The question doesn't read as a clear yes/no proposition.")
    ).not.toBeInTheDocument();
  });

  it("keeps the advanced section collapsed until toggled", () => {
    const flow = stubFlow();

    render(<CreateDraftForm flow={flow} />);

    expect(screen.queryByText("Liquidity parameter b")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(flow.toggleAdvanced).toHaveBeenCalledTimes(1);
  });

  it("exposes the liquidity controls when advanced is open", () => {
    const flow = stubFlow({ advanced: true });

    render(<CreateDraftForm flow={flow} />);

    expect(screen.getByText("Liquidity parameter b")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();
    expect(screen.getByLabelText(/Collateral token/)).toHaveValue("pUSD");
    expect(screen.getByLabelText(/Graduation target/)).toHaveValue("$2,500 matched");

    fireEvent.change(screen.getByLabelText("Virtual LMSR liquidity parameter b"), {
      target: { value: "3000" },
    });

    expect(flow.updateDraft).toHaveBeenCalledWith("liquidityParameter", 3000);
  });
});

type DraftFlow = ReturnType<typeof useCreateDraftFlow>;

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";

function draftFixture(): CreateMarketDraft {
  return {
    ...createInitialMarketDraft(new Date(INITIAL_NOW)),
    question: "Will it pop?",
    resolutionCriteria: "Resolves YES if it pops.",
  };
}

function readyWalletAction(): WalletCreateAction {
  return {
    disabled: false,
    kind: "ready",
    label: "Create market",
    message: null,
    run: vi.fn(),
  };
}

function stubFlow(overrides: Partial<DraftFlow> = {}): DraftFlow {
  const draft = draftFixture();

  return {
    advanced: false,
    applyGraduationPreset: vi.fn(),
    applyResolutionPreset: vi.fn(),
    canPersist: true,
    errorCount: 0,
    fieldFeedback: {},
    flowError: null,
    formDraft: draft,
    formLocked: false,
    isLoadingDraft: false,
    isPublishing: false,
    isSaving: false,
    isSubmitting: false,
    latestReview: null,
    preview: buildCreateMarketPreview(draft),
    publish: vi.fn(async () => {}),
    publishedMarket: null,
    returnToEditing: vi.fn(),
    saveAsTemplate: vi.fn(async () => {}),
    savedAt: null,
    serverDraft: null,
    stage: "editing",
    startFresh: vi.fn(),
    submitForReview: vi.fn(async () => {}),
    templateSaved: false,
    toggleAdvanced: vi.fn(),
    updateDraft: vi.fn(),
    updateDraftWith: vi.fn(
      (updater: (current: CreateMarketDraft) => CreateMarketDraft) => {
        updater(draftFixture());
      }
    ),
    visibleErrors: {},
    walletAction: readyWalletAction(),
    ...overrides,
  };
}
