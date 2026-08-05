import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { draftFeedbackItemFactory, draftReviewFactory } from "@/test/factories/drafts";

import {
  FeedbackItemCard,
  FeedbackPanel,
  ReviewScoreBars,
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

describe("ReviewScoreBars", () => {
  it("colors each dimension by its goodness, inverting the risk rows", () => {
    render(
      <ReviewScoreBars
        review={draftReviewFactory({
          scores: {
            contentSafety: 2,
            corroboration: 4,
            disputeRisk: 1,
            objectivity: 5,
            promptInjectionRisk: 5,
            publicKnowability: 3,
            sourceQuality: 0,
          },
        })}
      />
    );

    expect(scoreRow("Objectivity")).toEqual({
      color: "var(--yes)",
      raw: "5",
      width: "100%",
    });
    expect(scoreRow("Public knowability")).toEqual({
      color: "var(--pc-amber)",
      raw: "3",
      width: "60%",
    });
    expect(scoreRow("Source quality")).toEqual({
      color: "var(--no)",
      raw: "0",
      width: "0%",
    });
    expect(scoreRow("Corroboration")).toEqual({
      color: "var(--yes)",
      raw: "4",
      width: "80%",
    });
    expect(scoreRow("Content safety")).toEqual({
      color: "var(--pc-amber)",
      raw: "2",
      width: "40%",
    });
    expect(scoreRow("Dispute risk")).toEqual({
      color: "var(--yes)",
      raw: "1",
      width: "80%",
    });
    expect(scoreRow("Injection risk")).toEqual({
      color: "var(--no)",
      raw: "5",
      width: "0%",
    });
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
    expect(screen.getByText("Review scores")).toBeInTheDocument();
    expect(screen.getByText("Objectivity")).toBeInTheDocument();
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

/** Reads the rendered bar color/width plus the raw score for one dimension. */
function scoreRow(label: string) {
  const row = screen.getByText(label).parentElement;
  const fill = row?.querySelector("div")?.firstElementChild;

  if (!(fill instanceof HTMLElement) || !row?.lastElementChild) {
    throw new Error(`missing score bar for ${label}`);
  }

  return {
    color: fill.style.backgroundColor,
    raw: row.lastElementChild.textContent,
    width: fill.style.width,
  };
}

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
