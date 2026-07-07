import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PricePathPoint } from "@/domain/markets/types";

import { PriceCurve, windowPricePath } from "./price-curve";

// Companion to price-curve.test.tsx: covers only the branches the main suite
// leaves out (unmeasured layout, degenerate timestamps, tooltip edge flips).
describe("PriceCurve edge branches", () => {
  it("ignores pointer movement while the chart has no measured width", () => {
    const plot = renderCurve([{ cents: 30 }, { cents: 45 }], 0);

    pointerMove(plot, 150);

    expect(screen.queryByTestId("crosshair")).not.toBeInTheDocument();
  });

  it("omits time labels when timestamps cannot be parsed", () => {
    const plot = renderCurve([
      { at: "not-a-date", cents: 50 },
      { at: "also-not-a-date", cents: 62 },
    ]);

    pointerMove(plot, 290);

    const crosshair = screen.getByTestId("crosshair");
    expect(within(crosshair).getByText("62%")).toBeInTheDocument();
    expect(within(crosshair).queryByText(/[A-Z][a-z]{2} \d/)).not.toBeInTheDocument();
  });

  it("hides the range selector when any point lacks a timestamp", () => {
    renderCurve([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
      { cents: 55 },
      { at: "2026-06-13T13:00:00.000Z", cents: 62 },
    ]);

    expect(screen.queryByRole("button", { name: "ALL" })).not.toBeInTheDocument();
  });

  it("drops the time of day once the window spans multiple days", () => {
    const plot = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
      { at: "2026-06-16T12:00:00.000Z", cents: 62 },
    ]);

    pointerMove(plot, 290);

    const crosshair = screen.getByTestId("crosshair");
    expect(within(crosshair).getByText("Jun 16")).toBeInTheDocument();
    expect(within(crosshair).queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });

  it("flips the tooltip inward near the right edge", () => {
    const plot = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
      { at: "2026-06-13T12:15:00.000Z", cents: 62 },
    ]);

    pointerMove(plot, 290);

    const tooltip = screen.getByTestId("crosshair").querySelector("div.absolute.top-1");
    expect(tooltip).toHaveStyle({
      transform: "translateX(calc(-100% - 10px))",
    });
  });

  it("spreads samples evenly when every trade shares one timestamp", () => {
    const at = "2026-06-13T12:00:00.000Z";
    const samples = windowPricePath(
      [
        { at, cents: 40 },
        { at, cents: 50 },
        { at, cents: 60 },
      ],
      null
    );

    expect(samples.map((sample) => sample.x)).toEqual([0, 0.5, 1]);
    // A zero-width window has no meaningful time axis.
    renderCurve([
      { at, cents: 40 },
      { at, cents: 60 },
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
    renderCurve([{ at: "2026-06-13T12:00:00.000Z", cents: 40 }]);

    const [yesLine] = document.querySelectorAll("polyline");
    expect(yesLine?.getAttribute("points")).toBe("0.0,60.0 300.0,60.0");
  });
});

function renderCurve(points: PricePathPoint[], width = 300) {
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
