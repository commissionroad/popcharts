import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PricePoint } from "@/domain/markets/types";

import { PriceCurve, windowPricePath } from "./price-curve";

// Companion to price-curve.test.tsx: covers only the branches the main suite
// leaves out (unmeasured layout, degenerate timestamps, tooltip edge flips).
describe("PriceCurve edge branches", () => {
  it("ignores pointer movement while the chart has no measured width", () => {
    const plot = renderCurve(
      [
        { noCents: 70, yesCents: 30 },
        { noCents: 55, yesCents: 45 },
      ],
      0
    );

    pointerMove(plot, 150);

    expect(screen.queryByTestId("crosshair")).not.toBeInTheDocument();
  });

  it("omits time labels when timestamps cannot be parsed", () => {
    const plot = renderCurve([
      { at: "not-a-date", noCents: 50, yesCents: 50 },
      { at: "also-not-a-date", noCents: 38, yesCents: 62 },
    ]);

    pointerMove(plot, 290);

    const crosshair = screen.getByTestId("crosshair");
    expect(within(crosshair).getByText("62%")).toBeInTheDocument();
    expect(within(crosshair).queryByText(/[A-Z][a-z]{2} \d/)).not.toBeInTheDocument();
  });

  it("hides the range selector when any point lacks a timestamp", () => {
    renderCurve([
      { at: "2026-06-13T12:00:00.000Z", noCents: 50, yesCents: 50 },
      { noCents: 45, yesCents: 55 },
      { at: "2026-06-13T13:00:00.000Z", noCents: 38, yesCents: 62 },
    ]);

    expect(screen.queryByRole("button", { name: "ALL" })).not.toBeInTheDocument();
  });

  it("drops the time of day once the window spans multiple days", () => {
    const plot = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", noCents: 50, yesCents: 50 },
      { at: "2026-06-16T12:00:00.000Z", noCents: 38, yesCents: 62 },
    ]);

    pointerMove(plot, 290);

    const crosshair = screen.getByTestId("crosshair");
    expect(within(crosshair).getByText("Jun 16")).toBeInTheDocument();
    expect(within(crosshair).queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  it("flips the tooltip inward near the right edge", () => {
    const plot = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", noCents: 50, yesCents: 50 },
      { at: "2026-06-13T12:15:00.000Z", noCents: 38, yesCents: 62 },
    ]);

    pointerMove(plot, 290);

    const tooltip = screen.getByTestId("crosshair").querySelector("div.absolute.top-1");
    expect(tooltip).toHaveStyle({
      transform: "translateX(calc(-100% - 10px))",
    });
  });

  it("spreads samples evenly when every trade shares one timestamp", () => {
    const at = "2026-06-13T12:00:00.000Z";
    const { samples, timeSpan } = windowPricePath(
      [
        { at, noCents: 60, yesCents: 40 },
        { at, noCents: 50, yesCents: 50 },
        { at, noCents: 40, yesCents: 60 },
      ],
      null
    );

    expect(samples.map((sample) => sample.x)).toEqual([0, 0.5, 1]);
    // A zero-width window cannot place a dated annotation either.
    expect(timeSpan).toBeNull();
    // A zero-width window has no meaningful time axis.
    renderCurve([
      { at, noCents: 60, yesCents: 40 },
      { at, noCents: 40, yesCents: 60 },
    ]);
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  it("renders labels without values for an empty path", () => {
    renderCurve([]);

    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("NO")).toBeInTheDocument();
    expect(screen.queryByTestId("legend-yes-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legend-no-value")).not.toBeInTheDocument();
  });

  it("draws a flat line for a single windowed sample", () => {
    renderCurve([{ at: "2026-06-13T12:00:00.000Z", noCents: 60, yesCents: 40 }]);

    const [yesLine] = document.querySelectorAll("polyline");
    expect(yesLine?.getAttribute("points")).toBe("0.0,60.0 300.0,60.0");
  });
});

function renderCurve(points: PricePoint[], width = 300) {
  render(<PriceCurve points={points} />);
  const plot = screen.getByTestId("price-curve-plot");
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({
    bottom: 170,
    height: 170,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
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
