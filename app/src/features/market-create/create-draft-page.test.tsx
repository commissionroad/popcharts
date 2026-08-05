import type { MarketDraftBondShortfall } from "@popcharts/api-client/models";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";
import type { ReviewCreditDepositState } from "@/integrations/contracts/hooks/use-review-credit";
import { draftReviewFactory, marketDraftFactory } from "@/test/factories/drafts";

import { CreateDraftPage } from "./create-draft-page";
import type { useCreateDraftFlow } from "./use-create-draft-flow";
import type { WalletCreateAction } from "./wallet-create-action";

const useDraftFlowMock = vi.hoisted(() => vi.fn());

vi.mock("./use-create-draft-flow", () => ({
  useCreateDraftFlow: useDraftFlowMock,
}));

const configState = vi.hoisted(() => ({ marketCreationMode: "mock" }));

vi.mock("@/integrations/contracts/config", () => ({
  get marketCreationMode() {
    return configState.marketCreationMode;
  },
}));

// The real ReviewCreditPanel renders inside the page; stub its chain hook so
// the page test stays off wagmi and the wallet stack.
const reviewCreditMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/contracts/hooks/use-review-credit", () => ({
  useReviewCreditDeposit: reviewCreditMock,
}));

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";
const QUESTION = "Will bitcoin close above $100k on 2027-01-01?";

beforeEach(() => {
  useDraftFlowMock.mockReset();
  reviewCreditMock.mockReset();
  reviewCreditMock.mockReturnValue(reviewCreditState());
  configState.marketCreationMode = "mock";
});

describe("CreateDraftPage", () => {
  it("renders the launchpad editor with the draft preview by default", () => {
    stubFlow();

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(useDraftFlowMock).toHaveBeenCalledWith({
      initialDraftId: null,
      initialNow: INITIAL_NOW,
    });
    expect(screen.getByRole("heading", { name: "Bake a market" })).toBeInTheDocument();
    expect(screen.getByText("Launchpad")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Draft it, get instant AI feedback, publish when it's approved\./
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(screen.getByText("Connect a wallet to save drafts")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("threads an initial draft id from the studio into the flow", () => {
    stubFlow();

    render(<CreateDraftPage initialDraftId="7" initialNow={INITIAL_NOW} />);

    expect(useDraftFlowMock).toHaveBeenCalledWith({
      initialDraftId: "7",
      initialNow: INITIAL_NOW,
    });
  });

  it("wires the save indicator to the flow's autosave state", () => {
    stubFlow({
      canPersist: true,
      savedAt: "2026-07-30T12:00:00.000Z",
      serverDraft: marketDraftFactory(),
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Saved · draft #12")).toBeInTheDocument();
  });

  it("surfaces flow errors", () => {
    stubFlow({ flowError: "The draft service hit a snag — try again." });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The draft service hit a snag — try again."
    );
  });

  it("submits the draft for review from the preview panel", () => {
    const flow = stubFlow();

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    fireEvent.click(screen.getByRole("button", { name: /Submit for AI review/ }));

    expect(flow.submitForReview).toHaveBeenCalledTimes(1);
  });

  it("shows the review progress panel while the review runs", () => {
    stubFlow({
      serverDraft: marketDraftFactory({ status: "in_review" }),
      stage: "in_review",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("AI review in progress")).toBeInTheDocument();
    expect(screen.getByText(`“${QUESTION}”`)).toBeInTheDocument();
  });

  it("shows the approved panel and publishes through the flow", () => {
    const flow = stubFlow({
      serverDraft: marketDraftFactory({ status: "approved" }),
      stage: "approved",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Waived in preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Publish & pay/ }));

    expect(flow.publish).toHaveBeenCalledTimes(1);
  });

  it("keeps the review scores reachable on an approved draft", () => {
    const review = draftReviewFactory();

    stubFlow({
      latestReview: review,
      serverDraft: marketDraftFactory({ status: "approved" }),
      stage: "approved",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    // Approved is not the same as strong: a weak dimension has to stay visible
    // next to the publish button, not be replaced by a green check.
    expect(screen.getByText("Review scores")).toBeInTheDocument();
    expect(screen.getByText("Corroboration")).toBeInTheDocument();
    expect(screen.getByText(review.scoreRationales.corroboration)).toBeInTheDocument();
  });

  it("omits the score panel on an approved draft that has no review", () => {
    stubFlow({
      latestReview: null,
      serverDraft: marketDraftFactory({ status: "approved" }),
      stage: "approved",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.queryByText("Review scores")).not.toBeInTheDocument();
  });

  it("keeps the last scores while editing, flagged stale once the draft changes", () => {
    stubFlow({ latestReview: draftReviewFactory(), stage: "editing" });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Scores from last review")).toBeInTheDocument();
    expect(
      screen.getByText(/Resubmit to score the current version/)
    ).toBeInTheDocument();
  });

  it("does not flag the scores stale when the draft still hashes to the review", () => {
    stubFlow({
      latestReview: draftReviewFactory({
        metadataHash: buildCreateMarketPreview(draftFixture()).metadataHash,
      }),
      stage: "editing",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Review scores")).toBeInTheDocument();
    expect(
      screen.queryByText(/Resubmit to score the current version/)
    ).not.toBeInTheDocument();
  });

  it("charges the devchain creation fee label when configured", () => {
    configState.marketCreationMode = "devchain";
    stubFlow({
      serverDraft: marketDraftFactory({ status: "approved" }),
      stage: "approved",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("1 native USDC")).toBeInTheDocument();
  });

  it("shows rejected feedback and returns to editing", () => {
    const flow = stubFlow({
      isSubmitting: true,
      latestReview: draftReviewFactory({ verdict: "reject" }),
      serverDraft: marketDraftFactory({ status: "rejected" }),
      stage: "feedback",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Not approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resubmitting…" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Fix the draft" }));

    expect(flow.returnToEditing).toHaveBeenCalledTimes(1);
  });

  it("shows changes-requested feedback and resubmits through the flow", () => {
    const flow = stubFlow({
      latestReview: draftReviewFactory(),
      serverDraft: marketDraftFactory({ status: "changes_requested" }),
      stage: "feedback",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Changes requested")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resubmit as is" }));

    expect(flow.submitForReview).toHaveBeenCalledTimes(1);
  });

  it("treats an edited draft with a rejecting review as rejected feedback", () => {
    stubFlow({
      latestReview: draftReviewFactory({ verdict: "reject" }),
      serverDraft: marketDraftFactory({ status: "editing" }),
      stage: "feedback",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Not approved")).toBeInTheDocument();
  });

  it("shows the published panel and wires its actions", () => {
    const flow = stubFlow({
      serverDraft: marketDraftFactory({
        publishedChainId: 31337,
        publishedMarketId: "9",
        status: "published",
      }),
      stage: "published",
    });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Market live")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Save as template/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create another/ }));

    expect(flow.saveAsTemplate).toHaveBeenCalledTimes(1);
    expect(flow.startFresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to the draft preview when a stage panel's draft is missing", () => {
    stubFlow({ serverDraft: null, stage: "published" });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Live preview")).toBeInTheDocument();
  });

  it("takes the aside over with the credit panel when the meter refuses", () => {
    const flow = stubFlow({ bondShortfall: bondShortfallFixture() });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(screen.getByText("Review credit needed")).toBeInTheDocument();
    expect(screen.getByText("You're out of review credit.")).toBeInTheDocument();
    expect(screen.queryByText("Live preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss credit prompt" }));

    expect(flow.clearBondShortfall).toHaveBeenCalledTimes(1);
  });

  it("resubmits the draft once the deposit confirms, without a poller", () => {
    // No fetchCredit on the flow: the panel funds immediately on confirm and
    // the resubmit's own 402 would re-open it if the indexer still lags.
    reviewCreditMock.mockReturnValue(reviewCreditState({ status: "success" }));
    const flow = stubFlow({ bondShortfall: bondShortfallFixture() });

    render(<CreateDraftPage initialNow={INITIAL_NOW} />);

    expect(flow.submitForReview).toHaveBeenCalledTimes(1);
  });
});

type DraftFlow = ReturnType<typeof useCreateDraftFlow>;

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

function bondShortfallFixture(): MarketDraftBondShortfall {
  return {
    availableWad: "0",
    message: "You're out of review credit.",
    requiredWad: "100000000000000000",
    runsUsed: 3,
  };
}

function reviewCreditState(
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

function stubFlow(overrides: Partial<DraftFlow> = {}): DraftFlow {
  const draft = draftFixture();
  const flow: DraftFlow = {
    advanced: false,
    applyGraduationPreset: vi.fn(),
    applyResolutionPreset: vi.fn(),
    bondShortfall: null,
    canPersist: false,
    clearBondShortfall: vi.fn(),
    errorCount: 0,
    fetchCredit: null,
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
    updateDraftWith: vi.fn(),
    visibleErrors: {},
    walletAction: readyWalletAction(),
    ...overrides,
  };

  useDraftFlowMock.mockReturnValue(flow);

  return flow;
}
