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
  it("defaults to the first time-ordered receipt when no initial receipt is provided", () => {
    render(<ReceiptAnatomyView matches={matches} receipts={[...receipts].reverse()} />);

    expect(screen.getAllByText("Early climb").length).toBeGreaterThan(0);
    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("57%");
  });

  it("falls back to the first receipt when the initial id is not present", () => {
    renderAnatomy({ initialReceiptId: "missing-receipt" });

    expect(screen.getAllByText("Early climb").length).toBeGreaterThan(0);
    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("57%");
  });

  it("renders nothing when no receipts are available", () => {
    const { container } = render(<ReceiptAnatomyView matches={[]} receipts={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

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

    const firstMatchedSlice = screen.getByTestId("anatomy-segment-matched-38-50");
    const secondMatchedSlice = screen.getByTestId("anatomy-segment-matched-50-62");

    fireEvent.mouseEnter(firstMatchedSlice);

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(within(detail).getByText("Matched segment")).toBeInTheDocument();
    expect(within(detail).getByText("38c-50c")).toBeInTheDocument();
    expect(within(detail).getAllByText("Rain fades").length).toBeGreaterThan(0);

    fireEvent.mouseEnter(secondMatchedSlice);
    expect(within(detail).getByText("50c-62c")).toBeInTheDocument();
    expect(within(detail).getAllByText("Heat cap").length).toBeGreaterThan(0);

    fireEvent.mouseLeave(secondMatchedSlice);
    expect(within(detail).getByText("38c-50c")).toBeInTheDocument();
  });

  it("shows refunded detail for unmatched slices", () => {
    renderAnatomy();

    const refundedSlice = screen.getByTestId("anatomy-segment-refunded-20-38");

    fireEvent.focus(refundedSlice);

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(within(detail).getByText("Refunded segment")).toBeInTheDocument();
    expect(within(detail).getByText("20c-38c")).toBeInTheDocument();
    expect(within(detail).getByText("No counterpart")).toBeInTheDocument();

    fireEvent.blur(refundedSlice);
    expect(within(detail).getByText("Matched segment")).toBeInTheDocument();
    expect(within(detail).getByText("38c-50c")).toBeInTheDocument();
  });

  it("hides segment detail when the active slice disappears after data changes", () => {
    const { rerender } = renderAnatomy();

    fireEvent.focus(screen.getByTestId("anatomy-segment-refunded-20-38"));
    expect(screen.getByTestId("anatomy-active-detail")).toBeInTheDocument();

    rerender(
      <ReceiptAnatomyView initialReceiptId="y-early" matches={[]} receipts={receipts} />
    );

    expect(screen.queryByTestId("anatomy-active-detail")).not.toBeInTheDocument();
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

  it("can switch to a NO receipt and keep refunded slices readable", () => {
    renderAnatomy();

    fireEvent.click(screen.getByTestId("receipt-selector-n-early"));
    fireEvent.focus(screen.getByTestId("anatomy-segment-refunded-50-70"));

    const detail = screen.getByTestId("anatomy-active-detail");
    expect(screen.getAllByText("Rain fades").length).toBeGreaterThan(0);
    expect(within(detail).getByText("Refunded segment")).toBeInTheDocument();
    expect(within(detail).getByText("50c-70c")).toBeInTheDocument();
  });

  it("ignores match records that do not overlap the selected receipt", () => {
    renderAnatomy({
      matches: [
        ...matches,
        {
          id: "outside-selected-band",
          priceBand: { fromProbability: 80, toProbability: 90 },
          receiptIds: ["y-early", "n-early"],
        },
      ],
    });

    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("57%");
    expect(
      screen.queryByTestId("anatomy-segment-matched-80-90")
    ).not.toBeInTheDocument();
  });

  it("ignores match records that have no overlapping counterpart receipt", () => {
    renderAnatomy({
      matches: [
        ...matches,
        {
          id: "missing-counterpart",
          priceBand: { fromProbability: 20, toProbability: 30 },
          receiptIds: ["y-early", "missing-receipt"],
        },
      ],
    });

    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("57%");
    expect(
      screen.queryByTestId("anatomy-segment-matched-20-30")
    ).not.toBeInTheDocument();
  });

  it("handles a zero-width receipt without rendering segment details", () => {
    renderAnatomy({
      matches: [],
      receipts: [
        {
          id: "zero-band",
          label: "Zero-width receipt",
          placedAtLabel: "10:10",
          placedAtMs: 1,
          priceBand: { fromProbability: 50, toProbability: 50 },
          side: "yes",
        },
      ],
    });

    expect(screen.getByTestId("anatomy-summary-matched")).toHaveTextContent("0%");
    expect(screen.getByText("unmatched")).toBeInTheDocument();
    expect(screen.queryByTestId("anatomy-active-detail")).not.toBeInTheDocument();
  });
});

function renderAnatomy({
  initialReceiptId = "y-early",
  matches: matchFixture = matches,
  receipts: receiptFixture = receipts,
}: {
  initialReceiptId?: string;
  matches?: MatchingBandMatch[];
  receipts?: MatchingBandReceipt[];
} = {}) {
  return render(
    <ReceiptAnatomyView
      initialReceiptId={initialReceiptId}
      matches={matchFixture}
      receipts={receiptFixture}
    />
  );
}
