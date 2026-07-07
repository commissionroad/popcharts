import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PricePathPoint } from "@/domain/markets/types";

import { PriceCurve, windowPricePath } from "./price-curve";

const HOUR_MS = 60 * 60 * 1000;

const points: PricePathPoint[] = [
  { at: "2026-06-13T12:00:00.000Z", cents: 50 },
  { at: "2026-06-13T12:05:00.000Z", cents: 60 },
  { at: "2026-06-13T12:10:00.000Z", cents: 40 },
  { at: "2026-06-13T12:15:00.000Z", cents: 75 },
];

function renderCurve(
  pathPoints: PricePathPoint[] = points,
  labels: { noLabel?: string; yesLabel?: string } = {}
) {
  render(<PriceCurve points={pathPoints} {...labels} />);
  const plot = screen.getByTestId("price-curve-plot");
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
    bottom: 170,
    height: 170,
    left: 0,
    right: 300,
    toJSON: () => ({}),
    top: 0,
    width: 300,
    x: 0,
    y: 0,
  });

  return plot;
}

// jsdom has no PointerEvent constructor; a MouseEvent with the pointermove
// type carries clientX and still triggers React's onPointerMove handler.
function pointerMove(plot: HTMLElement, clientX: number) {
  fireEvent(plot, new MouseEvent("pointermove", { bubbles: true, clientX }));
}

describe("windowPricePath", () => {
  const now = Date.parse("2026-06-13T12:00:00.000Z");
  const timed: PricePathPoint[] = [
    { at: new Date(now - 72 * HOUR_MS).toISOString(), cents: 30 },
    { at: new Date(now - 2 * HOUR_MS).toISOString(), cents: 40 },
    { at: new Date(now - HOUR_MS / 2).toISOString(), cents: 60 },
    { at: new Date(now).toISOString(), cents: 70 },
  ];

  it("spans the full history for the ALL range", () => {
    const samples = windowPricePath(timed, null);

    expect(samples).toHaveLength(4);
    expect(samples[0]).toMatchObject({ cents: 30, x: 0 });
    expect(samples.at(-1)).toMatchObject({ cents: 70, x: 1 });
  });

  it("keeps only the trailing window and anchors the standing price", () => {
    const samples = windowPricePath(timed, HOUR_MS);

    // The anchor carries the price standing at the window start (the 40-cent
    // sample from two hours ago), then the two in-window samples follow.
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({ cents: 40, x: 0 });
    expect(samples[1]).toMatchObject({ cents: 60, x: 0.5 });
    expect(samples.at(-1)).toMatchObject({ cents: 70, x: 1 });
  });

  it("clamps windows longer than the history to the full span", () => {
    const all = windowPricePath(timed, null);
    const month = windowPricePath(timed, 30 * 24 * HOUR_MS);

    expect(month).toEqual(all);
  });

  it("falls back to even spacing when timestamps are missing", () => {
    const samples = windowPricePath([{ cents: 50 }, { cents: 62 }], HOUR_MS);

    expect(samples).toEqual([
      { atMs: null, cents: 50, x: 0 },
      { atMs: null, cents: 62, x: 1 },
    ]);
  });
});

describe("PriceCurve", () => {
  it("shows both outcomes' latest prices in the legend", () => {
    renderCurve();

    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("75%");
    expect(screen.getByTestId("legend-no-value")).toHaveTextContent("25%");
  });

  it("respects creator-applied outcome labels", () => {
    renderCurve(points, { noLabel: "Egypt", yesLabel: "Argentina" });

    expect(screen.getByText("Argentina")).toBeInTheDocument();
    expect(screen.getByText("Egypt")).toBeInTheDocument();
    expect(screen.queryByText("YES")).not.toBeInTheDocument();
    expect(screen.queryByText("NO")).not.toBeInTheDocument();
  });

  it("renders dotted gridline values for each quarter level", () => {
    const plot = renderCurve();

    for (const level of ["25%", "50%", "75%", "100%"]) {
      expect(within(plot).getByText(level)).toBeInTheDocument();
    }
  });

  it("pins the crosshair readout to the hovered sample", () => {
    const plot = renderCurve();

    // 300px wide, 15-minute span: x=290 snaps to the final point (75 cents).
    pointerMove(plot, 290);

    const crosshair = screen.getByTestId("crosshair");
    expect(within(crosshair).getByText("75%")).toBeInTheDocument();
    expect(within(crosshair).getByText("25%")).toBeInTheDocument();
    // Intraday span, so the label includes the time of day.
    expect(within(crosshair).getByText(/Jun 13/)).toBeInTheDocument();
  });

  it("moves the readout as the pointer crosses sample boundaries", () => {
    const plot = renderCurve();

    pointerMove(plot, 110); // nearest sample 1 -> 60 cents
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("60%");

    pointerMove(plot, 190); // nearest sample 2 -> 40 cents
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("40%");
    expect(screen.getByTestId("legend-no-value")).toHaveTextContent("60%");
  });

  it("clears the crosshair when the pointer leaves", () => {
    const plot = renderCurve();

    pointerMove(plot, 290);
    expect(screen.getByTestId("crosshair")).toBeInTheDocument();

    fireEvent.pointerLeave(plot);
    expect(screen.queryByTestId("crosshair")).not.toBeInTheDocument();
    // The legend falls back to the latest sample.
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("75%");
  });

  it("windows the chart to the selected trailing range", () => {
    const now = Date.parse("2026-06-13T12:00:00.000Z");
    const plot = renderCurve([
      { at: new Date(now - 72 * HOUR_MS).toISOString(), cents: 30 },
      { at: new Date(now - 2 * HOUR_MS).toISOString(), cents: 40 },
      { at: new Date(now - HOUR_MS / 2).toISOString(), cents: 60 },
      { at: new Date(now).toISOString(), cents: 70 },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "1H" }));

    // The left edge is now the anchored price standing an hour before the
    // latest sample, not the 30-cent opening price.
    pointerMove(plot, 0);
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("40%");
  });

  it("hides the range selector and time axis when timestamps are missing", () => {
    renderCurve([{ cents: 50 }, { cents: 62 }]);

    expect(screen.queryByRole("button", { name: "ALL" })).not.toBeInTheDocument();
    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("62%");
  });

  it("ignores hover on single-point paths", () => {
    const plot = renderCurve([{ cents: 50 }]);

    pointerMove(plot, 150);

    expect(screen.queryByTestId("crosshair")).not.toBeInTheDocument();
  });
});
