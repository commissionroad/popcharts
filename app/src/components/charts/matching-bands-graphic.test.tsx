import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type MatchingBandMatch,
  type MatchingBandReceipt,
  MatchingBandsGraphic,
} from "./matching-bands-graphic";

const receipts: MatchingBandReceipt[] = [
  {
    amountUsd: 320,
    id: "y-early",
    label: "Early climb",
    placedAtLabel: "09:04",
    placedAtMs: 1,
    priceBand: { fromProbability: 20, toProbability: 62 },
    side: "yes",
  },
  {
    amountUsd: 180,
    id: "n-early",
    label: "Rain fades",
    placedAtLabel: "09:17",
    placedAtMs: 2,
    priceBand: { fromProbability: 70, toProbability: 38 },
    side: "no",
  },
  {
    id: "y-late",
    label: "Late drift",
    placedAtLabel: "09:25",
    placedAtMs: 3,
    priceBand: { fromProbability: 63, toProbability: 82 },
    side: "yes",
  },
  {
    amountUsd: 220,
    id: "n-late",
    label: "Heat cap",
    placedAtLabel: "09:41",
    placedAtMs: 4,
    priceBand: { fromProbability: 62, toProbability: 42 },
    side: "no",
  },
];

const matches: MatchingBandMatch[] = [
  {
    id: "match-a",
    priceBand: { fromProbability: 38, toProbability: 50 },
    receiptIds: ["y-early", "n-early"],
  },
  {
    id: "match-b",
    priceBand: { fromProbability: 50, toProbability: 62 },
    receiptIds: ["y-early", "n-late"],
  },
];

describe("MatchingBandsGraphic", () => {
  it("renders time-ordered receipt bands and the price axis", () => {
    const { container } = renderGraphic();

    for (const tick of ["0c", "25c", "50c", "75c", "100c"]) {
      expect(screen.getByText(tick)).toBeInTheDocument();
    }

    expect(screen.getByTestId("matching-band-y-early")).toHaveStyle({
      left: "20%",
      width: "42%",
    });
    expect(screen.getByTestId("matching-band-n-early")).toHaveStyle({
      left: "38%",
      width: "32%",
    });

    const text = container.textContent ?? "";
    expect(text.indexOf("Early climb")).toBeLessThan(text.indexOf("Rain fades"));
    expect(text.indexOf("Rain fades")).toBeLessThan(text.indexOf("Late drift"));
    expect(text.indexOf("Late drift")).toBeLessThan(text.indexOf("Heat cap"));
  });

  it("shows matched percentage, matched price, receipt amount, and counterpart bands on hover", () => {
    renderGraphic();

    fireEvent.mouseEnter(screen.getByTestId("matching-band-y-early"));

    const tooltip = screen.getByTestId("matching-band-tooltip");
    expect(within(tooltip).getByText("Early climb")).toBeInTheDocument();
    expect(within(tooltip).getByText("57%")).toBeInTheDocument();
    expect(within(tooltip).getByText("38c-62c avg 50c")).toBeInTheDocument();
    expect(within(tooltip).getByText("Rain fades, Heat cap")).toBeInTheDocument();
    expect(within(tooltip).getByText("$320")).toBeInTheDocument();
    expect(screen.getAllByTestId("matching-band-link")).toHaveLength(2);
  });

  it("merges adjacent matched segments inside the hovered receipt band", () => {
    renderGraphic();

    const segments = screen.getAllByTestId("matched-segment-y-early");

    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveStyle({
      left: "42.857142857142854%",
      width: "57.14285714285714%",
    });
  });

  it("clears the active match readout when the pointer leaves", () => {
    renderGraphic();

    const receipt = screen.getByTestId("matching-band-y-early");

    fireEvent.mouseEnter(receipt);
    expect(screen.getByTestId("matching-band-tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(receipt);
    expect(screen.queryByTestId("matching-band-tooltip")).not.toBeInTheDocument();
  });

  it("reports unmatched bands without drawing links", () => {
    renderGraphic();

    fireEvent.focus(screen.getByTestId("matching-band-y-late"));

    const tooltip = screen.getByTestId("matching-band-tooltip");
    expect(within(tooltip).getByText("0%")).toBeInTheDocument();
    expect(within(tooltip).getByText("unmatched")).toBeInTheDocument();
    expect(within(tooltip).getByText("No matched band")).toBeInTheDocument();
    expect(screen.queryByTestId("matching-band-link")).not.toBeInTheDocument();
    expect(tooltip.getAttribute("style")).toContain("translateX(calc(-100% - 10px))");
  });

  it("explains the color roles in the legend", () => {
    renderGraphic();

    expect(screen.getByText("Matched segment")).toBeInTheDocument();
    expect(screen.getByText("YES receipt path")).toBeInTheDocument();
    expect(screen.getByText("NO receipt path")).toBeInTheDocument();
    expect(screen.getByText("Active match link")).toBeInTheDocument();
  });
});

function renderGraphic() {
  return render(<MatchingBandsGraphic matches={matches} receipts={receipts} />);
}
