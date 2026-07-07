import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MarketAiReview } from "@/domain/markets/types";

import { AiReviewCard } from "./ai-review-card";

describe("AiReviewCard", () => {
  it.each([
    ["approve", "Approved"],
    ["manual_review", "Manual review"],
    ["reject", "Rejected"],
  ] as const)("renders the %s verdict label", (verdict, label) => {
    render(<AiReviewCard review={reviewFixture({ verdict })} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("labels the reviewer with the model id when present", () => {
    render(<AiReviewCard review={reviewFixture({ modelId: "claude-sonnet-4-5" })} />);

    expect(screen.getByText(/claude-sonnet-4-5/)).toBeInTheDocument();
  });

  it("falls back to the provider when the model id is missing", () => {
    const review = reviewFixture();
    delete review.modelId;

    render(<AiReviewCard review={review} />);

    expect(screen.getByText(/anthropic ·/)).toBeInTheDocument();
  });

  it("falls back to the provider when the model id is blank", () => {
    render(<AiReviewCard review={reviewFixture({ modelId: "   " })} />);

    expect(screen.getByText(/anthropic ·/)).toBeInTheDocument();
  });

  it("renders hard flags with spaces instead of underscores", () => {
    render(
      <AiReviewCard review={reviewFixture({ hardFlags: ["wash_trading", "spam"] })} />
    );

    expect(screen.getByText("wash trading")).toBeInTheDocument();
    expect(screen.getByText("spam")).toBeInTheDocument();
  });

  it("omits the hard flag row when there are no flags", () => {
    render(<AiReviewCard review={reviewFixture({ hardFlags: [] })} />);

    expect(screen.queryByText("wash trading")).not.toBeInTheDocument();
  });

  it("renders every score dimension with its clamped value", () => {
    render(
      <AiReviewCard
        review={reviewFixture({
          scores: {
            contentSafety: 7,
            corroboration: 1,
            disputeRisk: 5,
            objectivity: 5,
            promptInjectionRisk: -2,
            publicKnowability: 3,
            sourceQuality: 2,
          },
        })}
      />
    );

    expect(screen.getByText("Objectivity")).toBeInTheDocument();
    expect(screen.getByText("Public knowability")).toBeInTheDocument();
    expect(screen.getByText("Source quality")).toBeInTheDocument();
    expect(screen.getByText("Corroboration")).toBeInTheDocument();
    expect(screen.getByText("Content safety")).toBeInTheDocument();
    expect(screen.getByText("Dispute risk")).toBeInTheDocument();
    expect(screen.getByText("Prompt injection risk")).toBeInTheDocument();
    // contentSafety 7 clamps to 5; promptInjectionRisk -2 clamps to 0.
    expect(screen.getAllByText("5/5")).toHaveLength(3);
    expect(screen.getAllByText("0/5")).toHaveLength(1);
    expect(screen.getByText("1/5")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("renders reviewer notes when reasons exist", () => {
    render(
      <AiReviewCard review={reviewFixture({ reasons: ["Bright-line threshold."] })} />
    );

    expect(screen.getByText("Reviewer notes")).toBeInTheDocument();
    expect(screen.getByText("Bright-line threshold.")).toBeInTheDocument();
  });

  it("omits reviewer notes when there are no reasons", () => {
    render(<AiReviewCard review={reviewFixture({ reasons: [] })} />);

    expect(screen.queryByText("Reviewer notes")).not.toBeInTheDocument();
  });

  it("renders evidence links titled by the trimmed source title", () => {
    render(<AiReviewCard review={reviewFixture()} />);

    expect(screen.getByText("Evidence (1)")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "ETH price feed" });

    expect(link).toHaveAttribute("href", "https://example.com/eth");
    expect(screen.getByText("Specialist")).toBeInTheDocument();
  });

  it("falls back to the evidence domain when the title is blank or missing", () => {
    const untitled = evidenceFixture({ url: "https://b.example/2" });
    delete untitled.title;

    render(
      <AiReviewCard
        review={reviewFixture({
          evidence: [
            evidenceFixture({ title: "   ", url: "https://a.example/1" }),
            untitled,
          ],
        })}
      />
    );

    expect(screen.getAllByRole("link", { name: "example.com" })).toHaveLength(2);
  });

  it("omits the evidence section when there is none", () => {
    render(<AiReviewCard review={reviewFixture({ evidence: [] })} />);

    expect(screen.queryByText(/Evidence \(/)).not.toBeInTheDocument();
  });
});

function reviewFixture(overrides: Partial<MarketAiReview> = {}): MarketAiReview {
  return {
    evidence: [evidenceFixture()],
    hardFlags: [],
    modelId: "claude-sonnet-4-5",
    provider: "anthropic",
    reasons: ["Publicly verifiable outcome."],
    reviewedAt: "2026-06-02T09:15:00.000Z",
    scores: {
      contentSafety: 5,
      corroboration: 5,
      disputeRisk: 2,
      objectivity: 4,
      promptInjectionRisk: 0,
      publicKnowability: 5,
      sourceQuality: 4,
    },
    sourceChecks: [],
    verdict: "approve",
    ...overrides,
  };
}

function evidenceFixture(
  overrides: Partial<MarketAiReview["evidence"][number]> = {}
): MarketAiReview["evidence"][number] {
  return {
    domain: "example.com",
    kind: "provided_url",
    sourceTier: "specialist",
    summary: "A relevant price feed.",
    title: "ETH price feed",
    url: "https://example.com/eth",
    ...overrides,
  };
}
