import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBudgetBuy,
} from "@/integrations/contracts/virtual-lmsr";
import { formatCents } from "@/lib/format";

import { BImpactPreview } from "./b-impact-preview";

describe("BImpactPreview", () => {
  it("plots the LMSR curve and headline $100 impact for the chosen b", () => {
    render(<BImpactPreview b={5_000} openingProbability={50} />);

    expect(screen.getByText("b impact")).toBeInTheDocument();
    expect(screen.getByText("$100 YES impact")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "LMSR YES price curve by spend" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${expectedOpening(5_000, 50)} -> ${expectedImpact(5_000, 50, 100)}`
      )
    ).toBeInTheDocument();
  });

  it("shows the price after each sample budget", () => {
    render(<BImpactPreview b={500} openingProbability={20} />);

    for (const budget of [25, 50, 100, 250]) {
      expect(screen.getByText(`$${budget}`)).toBeInTheDocument();
    }

    expect(
      screen.getAllByText(expectedImpact(500, 20, 250)).length
    ).toBeGreaterThanOrEqual(1);
  });
});

function expectedOpening(b: number, openingProbability: number) {
  return formatCents(
    marginalPriceCents(createOpeningState({ b, openingProbability }), "yes")
  );
}

function expectedImpact(b: number, openingProbability: number, budget: number) {
  const state = createOpeningState({ b, openingProbability });

  return formatCents(
    marginalPriceCents(stateAfterBudgetBuy({ budget, side: "yes", state }), "yes")
  );
}
