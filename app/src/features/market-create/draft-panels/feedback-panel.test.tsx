import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { draftFeedbackItemFactory, draftReviewFactory } from "@/test/factories/drafts";

import {
  FeedbackItemCard,
  FeedbackPanel,
  ReviewScorePanel,
  severityStyle,
} from "./feedback-panel";

describe("severityStyle", () => {
  it("maps blockers to the no color", () => {
    const style = severityStyle("blocker");

    expect(style.label).toBe("Blocker");
    expect(style.color).toBe("var(--no)");
  });

  it("maps warnings to amber", () => {
    const style = severityStyle("warning");

    expect(style.label).toBe("Fix this");
    expect(style.color).toBe("var(--pc-amber)");
  });

  it("treats any other severity as a tip", () => {
    const style = severityStyle("info");

    expect(style.label).toBe("Tip");
    expect(style.color).toBe("var(--pc-cyan)");
  });
});

describe("FeedbackItemCard", () => {
  it("renders the issue and the fix in the full layout", () => {
    render(<FeedbackItemCard item={draftFeedbackItemFactory()} />);

    expect(screen.getByText("Fix this")).toBeInTheDocument();
    expect(screen.getByText("Phrase it as a yes/no question")).toBeInTheDocument();
    expect(
      screen.getByText("The question doesn't read as a clear yes/no proposition.")
    ).toBeInTheDocument();
    expect(screen.getByText("How to fix")).toBeInTheDocument();
    expect(screen.getByText(/Start with "Will", "Is", or "Does"/)).toBeInTheDocument();
  });

  it("drops the issue paragraph in the compact layout", () => {
    render(
      <FeedbackItemCard
        compact
        item={draftFeedbackItemFactory({ severity: "blocker" })}
      />
    );

    expect(screen.getByText("Blocker")).toBeInTheDocument();
    expect(
      screen.queryByText("The question doesn't read as a clear yes/no proposition.")
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Start with "Will", "Is", or "Does"/)).toBeInTheDocument();
  });
});

describe("ReviewScorePanel", () => {
  it("renders the dimensions and their rationales behind a disclosure", () => {
    const review = draftReviewFactory();

    render(<ReviewScorePanel review={review} />);

    expect(screen.getByText("Review scores")).toBeInTheDocument();
    expect(screen.getByText("Objectivity")).toBeInTheDocument();
    expect(screen.getByText(review.scoreRationales.objectivity)).toBeInTheDocument();
  });

  it("arrives expanded", () => {
    const { container } = render(<ReviewScorePanel review={draftReviewFactory()} />);

    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("says so when the draft has moved on since the review", () => {
    render(<ReviewScorePanel review={draftReviewFactory()} stale />);

    expect(screen.getByText("Scores from last review")).toBeInTheDocument();
    expect(
      screen.getByText(/Resubmit to score the current version/)
    ).toBeInTheDocument();
  });

  it("does not warn about staleness for a current review", () => {
    render(<ReviewScorePanel review={draftReviewFactory()} />);

    expect(
      screen.queryByText(/Resubmit to score the current version/)
    ).not.toBeInTheDocument();
  });
});

describe("FeedbackPanel", () => {
  it("presents a changes-requested verdict with the summary, items, and scores", () => {
    render(panel());

    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("AI review · heuristic")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Almost there — fix the flagged issues below and resubmit for review."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Phrase it as a yes/no question")).toBeInTheDocument();
    // Scores sit inline on the failure path rather than behind a disclosure:
    // this is the screen a creator is meant to act on.
    expect(screen.getByText("Objectivity")).toBeInTheDocument();
    expect(
      screen.getByText(draftReviewFactory().scoreRationales.objectivity)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resubmit as is" })).toBeEnabled();
    expect(
      screen.getByText("Edits re-run the review with fresh eyes")
    ).toBeInTheDocument();
  });

  it("presents a rejected verdict", () => {
    render(panel({ verdict: "rejected" }));

    expect(screen.getByText("Not approved")).toBeInTheDocument();
    expect(screen.queryByText("Changes requested")).not.toBeInTheDocument();
  });

  it("labels and disables resubmission while it is in flight", () => {
    render(panel({ isResubmitting: true }));

    expect(screen.getByRole("button", { name: "Resubmitting…" })).toBeDisabled();
  });

  it("fires the edit and resubmit callbacks", () => {
    const onEdit = vi.fn();
    const onResubmit = vi.fn();

    render(panel({ onEdit, onResubmit }));

    fireEvent.click(screen.getByRole("button", { name: "Fix the draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Resubmit as is" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onResubmit).toHaveBeenCalledTimes(1);
  });
});

function panel(overrides: Partial<Parameters<typeof FeedbackPanel>[0]> = {}) {
  return (
    <FeedbackPanel
      isResubmitting={false}
      onEdit={vi.fn()}
      onResubmit={vi.fn()}
      review={draftReviewFactory()}
      verdict="changes_requested"
      {...overrides}
    />
  );
}
