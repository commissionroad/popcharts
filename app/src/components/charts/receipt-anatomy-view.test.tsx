import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  type MatchingBandMatch,
  type MatchingBandReceipt,
} from "./matching-bands-graphic";
import { ReceiptAnatomyView } from "./receipt-anatomy-view";

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
    amountUsd: 220,
    id: "n-late",
    label: "Heat cap",
    placedAtLabel: "09:41",
    placedAtMs: 4,
    priceBand: { fromProbability: 62, toProbability: 42 },
    side: "no",
  },
  {
    id: "y-late",
    label: "Late drift",
    placedAtLabel: "09:52",
    placedAtMs: 5,
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
    receiptIds: ["y-early", "n-late"],
  },
];

describe("ReceiptAnatomyView", () => {
  it("summarizes the selected receipt and renders its exploded slices", () => {
    renderAnatomy();

    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("57%");
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("Avg matched price")).toBeInTheDocument();
    expect(screen.getByText("50c")).toBeInTheDocument();

    expect(screen.getByTestId("anatomy-segment-refunded-20-38")).toBeInTheDocument();
    expect(screen.getByTestId("anatomy-segment-matched-38-50")).toBeInTheDocument();
    expect(screen.getByTestId("anatomy-segment-matched-50-62")).toBeInTheDocument();
  });

  it("shows counterpart detail when hovering a matched slice", () => {
    renderAnatomy();

    fireEvent.mouseEnter(screen.getByTestId("anatomy-segment-matched-38-50"));

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(within(detail).getByText("Matched segment")).toBeInTheDocument();
    expect(within(detail).getByText("38c-50c")).toBeInTheDocument();
    expect(within(detail).getAllByText("Rain fades").length).toBeGreaterThan(0);
  });

  it("shows refunded detail for unmatched slices", () => {
    renderAnatomy();

    fireEvent.focus(screen.getByTestId("anatomy-segment-refunded-20-38"));

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(within(detail).getByText("Refunded segment")).toBeInTheDocument();
    expect(within(detail).getByText("20c-38c")).toBeInTheDocument();
    expect(within(detail).getByText("No counterpart")).toBeInTheDocument();
  });

  it("can switch to a receipt that has not cleared against any counterpart", () => {
    renderAnatomy();

    fireEvent.click(screen.getByTestId("receipt-selector-y-late"));

    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("0%");
    expect(screen.getByText("unmatched")).toBeInTheDocument();

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(within(detail).getByText("Refunded segment")).toBeInTheDocument();
    expect(within(detail).getByText("63c-82c")).toBeInTheDocument();
    expect(within(detail).getByText("No counterpart")).toBeInTheDocument();
  });
});

function renderAnatomy() {
  return render(
    <ReceiptAnatomyView
      initialReceiptId="y-early"
      matches={matches}
      receipts={receipts}
    />
  );
}
