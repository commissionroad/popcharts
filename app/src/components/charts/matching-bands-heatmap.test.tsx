import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type MatchingBandMatch,
  type MatchingBandReceipt,
} from "./matching-bands-graphic";
import { MatchingBandsHeatmap } from "./matching-bands-heatmap";

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
    receiptIds: ["y-early", "n-early"],
  },
];

describe("MatchingBandsHeatmap", () => {
  it("renders the price axis and time-ordered receipt rows", () => {
    const { container } = renderHeatmap();

    for (const tick of ["0c", "25c", "50c", "75c", "100c"]) {
      expect(screen.getByText(tick)).toBeInTheDocument();
    }

    const text = container.textContent ?? "";
    expect(text.indexOf("Early climb")).toBeLessThan(text.indexOf("Rain fades"));
    expect(text.indexOf("Rain fades")).toBeLessThan(text.indexOf("Late drift"));
  });

  it("shows cleared overlap details when hovering a matched cell", () => {
    renderHeatmap();

    const cell = screen.getByTestId("heatmap-cell-y-early-40");

    fireEvent.mouseEnter(cell);

    const tooltip = screen.getByTestId("heatmap-tooltip");
    expect(within(tooltip).getByText("Early climb")).toBeInTheDocument();
    expect(within(tooltip).getByText("40c-50c")).toBeInTheDocument();
    expect(within(tooltip).getByText("Cleared overlap")).toBeInTheDocument();
    expect(within(tooltip).getByText("Rain fades")).toBeInTheDocument();
    expect(within(tooltip).getByText("$320")).toBeInTheDocument();

    fireEvent.mouseLeave(cell);
    expect(screen.queryByTestId("heatmap-tooltip")).not.toBeInTheDocument();
  });

  it("shows receipt-path cells that do not clear", () => {
    renderHeatmap();

    fireEvent.focus(screen.getByTestId("heatmap-cell-y-late-70"));

    const tooltip = screen.getByTestId("heatmap-tooltip");
    expect(within(tooltip).getByText("Late drift")).toBeInTheDocument();
    expect(within(tooltip).getByText("70c-80c")).toBeInTheDocument();
    expect(within(tooltip).getByText("Receipt path")).toBeInTheDocument();
    expect(within(tooltip).getByText("No cleared overlap")).toBeInTheDocument();
  });

  it("shows empty cells with no receipt path", () => {
    renderHeatmap();

    fireEvent.focus(screen.getByTestId("heatmap-cell-y-early-0"));

    const tooltip = screen.getByTestId("heatmap-tooltip");
    expect(within(tooltip).getByText("0c-10c")).toBeInTheDocument();
    expect(within(tooltip).getByText("No path")).toBeInTheDocument();
    expect(within(tooltip).getByText("No cleared overlap")).toBeInTheDocument();
  });

  it("falls back to receipt ids when match counterpart details are missing", () => {
    renderHeatmap({
      matches: [
        ...matches,
        {
          id: "missing-counterpart",
          priceBand: { fromProbability: 20, toProbability: 30 },
          receiptIds: ["y-early", "missing-receipt"],
        },
      ],
    });

    fireEvent.focus(screen.getByTestId("heatmap-cell-y-early-20"));

    const tooltip = screen.getByTestId("heatmap-tooltip");
    expect(within(tooltip).getByText("missing-receipt")).toBeInTheDocument();
  });

  it("explains the heatmap palette in the legend", () => {
    renderHeatmap();

    expect(screen.getByText("YES coverage")).toBeInTheDocument();
    expect(screen.getByText("NO coverage")).toBeInTheDocument();
    expect(screen.getByText("Cleared overlap")).toBeInTheDocument();
    expect(screen.getByText("No receipt path")).toBeInTheDocument();
  });
});

function renderHeatmap({
  matches: matchFixture = matches,
  receipts: receiptFixture = receipts,
}: {
  matches?: MatchingBandMatch[];
  receipts?: MatchingBandReceipt[];
} = {}) {
  return render(
    <MatchingBandsHeatmap matches={matchFixture} receipts={receiptFixture} />
  );
}
