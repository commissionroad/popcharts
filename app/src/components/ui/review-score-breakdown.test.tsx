import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AiReviewScoreRationales, AiReviewScores } from "@/domain/markets/types";

import { ReviewScoreBreakdown } from "./review-score-breakdown";

const RATIONALES: AiReviewScoreRationales = {
  contentSafety: "Nothing unsafe in the wording.",
  corroboration: "Two independent sources agree.",
  disputeRisk: "Little room to argue the outcome.",
  objectivity: "Resolves on a published number.",
  promptInjectionRisk: "No instruction-like text.",
  publicKnowability: "The result is public on settlement day.",
  sourceQuality: "One primary source, one major-news.",
};

describe("ReviewScoreBreakdown", () => {
  it("renders every dimension with its score and rationale", () => {
    render(breakdown());

    for (const label of [
      "Objectivity",
      "Public knowability",
      "Source quality",
      "Corroboration",
      "Content safety",
      "Dispute risk",
      "Prompt injection risk",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    for (const rationale of Object.values(RATIONALES)) {
      expect(screen.getByText(rationale)).toBeInTheDocument();
    }
  });

  it("clamps scores outside the 0-5 range", () => {
    render(
      breakdown({
        scores: scoresFixture({ contentSafety: 9, promptInjectionRisk: -3 }),
      })
    );

    expect(meter("Content safety").filled).toBe(5);
    expect(meter("Prompt injection risk").filled).toBe(0);
  });

  it("rounds fractional scores to whole segments", () => {
    render(breakdown({ scores: scoresFixture({ objectivity: 3.6 }) }));

    expect(meter("Objectivity")).toEqual({
      filled: 4,
      readout: "4/5",
      tone: "var(--yes)",
    });
  });

  it("tones a plain dimension by its raw score", () => {
    render(
      breakdown({
        scores: scoresFixture({
          corroboration: 2,
          objectivity: 4,
          sourceQuality: 1,
        }),
      })
    );

    expect(meter("Objectivity").tone).toBe("var(--yes)");
    expect(meter("Corroboration").tone).toBe("var(--pc-amber)");
    expect(meter("Source quality").tone).toBe("var(--no)");
  });

  it("inverts the tone scale for risk dimensions", () => {
    render(
      breakdown({
        scores: scoresFixture({ disputeRisk: 1, promptInjectionRisk: 5 }),
      })
    );

    // A low dispute risk is good news, a maxed injection risk is bad — the
    // meters fill by raw score but must not colour the two the same way.
    expect(meter("Dispute risk")).toEqual({
      filled: 1,
      readout: "1/5",
      tone: "var(--yes)",
    });
    expect(meter("Prompt injection risk")).toEqual({
      filled: 5,
      readout: "5/5",
      tone: "var(--no)",
    });
  });

  it("lays out one column by default and two on request", () => {
    const { container, rerender } = render(breakdown());

    expect(container.firstElementChild).not.toHaveClass("sm:grid-cols-2");

    rerender(breakdown({ columns: 2 }));

    expect(container.firstElementChild).toHaveClass("sm:grid-cols-2");
  });
});

function breakdown({
  columns,
  scores = scoresFixture(),
}: {
  columns?: 1 | 2;
  scores?: AiReviewScores;
} = {}) {
  return (
    <ReviewScoreBreakdown
      {...(columns ? { columns } : {})}
      scoreRationales={RATIONALES}
      scores={scores}
    />
  );
}

function scoresFixture(overrides: Partial<AiReviewScores> = {}): AiReviewScores {
  return {
    contentSafety: 5,
    corroboration: 4,
    disputeRisk: 2,
    objectivity: 4,
    promptInjectionRisk: 1,
    publicKnowability: 3,
    sourceQuality: 2,
    ...overrides,
  };
}

/**
 * Reads one dimension's meter: how many of the five segments are filled, the
 * tone they carry, and the "n/5" readout. Unfilled segments use the neutral
 * border colour, so counting them is what distinguishes a 0 from a 5. Scoped
 * to the dimension's own row — several dimensions share a score, so a bare
 * getByText("4/5") is ambiguous.
 */
function meter(label: string) {
  const heading = screen.getByText(label).parentElement;
  const row = heading?.parentElement;
  const segments = row?.querySelectorAll<HTMLElement>("span.h-1\\.5");

  if (!segments || segments.length !== 5) {
    throw new Error(`missing score meter for ${label}`);
  }

  const filled = [...segments].filter(
    (segment) => segment.style.backgroundColor !== "var(--border)"
  );

  return {
    filled: filled.length,
    ...(heading?.lastElementChild
      ? { readout: heading.lastElementChild.textContent }
      : {}),
    ...(filled[0] ? { tone: filled[0].style.backgroundColor } : {}),
  };
}
