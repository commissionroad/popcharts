import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PricePathPoint } from "@/domain/markets/types";

import { PriceCurve } from "./price-curve";

const points: PricePathPoint[] = [
  { at: "2026-06-13T12:00:00.000Z", cents: 50 },
  { at: "2026-06-13T12:05:00.000Z", cents: 60 },
  { at: "2026-06-13T12:10:00.000Z", cents: 40 },
  { at: "2026-06-13T12:15:00.000Z", cents: 75 },
];

function renderCurve(pathPoints: PricePathPoint[] = points) {
  render(<PriceCurve points={pathPoints} side="yes" />);
  const container = screen.getByTestId("price-curve");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    bottom: 150,
    height: 150,
    left: 0,
    right: 300,
    toJSON: () => ({}),
    top: 0,
    width: 300,
    x: 0,
    y: 0,
  });

  return container;
}

// jsdom has no PointerEvent constructor; a MouseEvent with the pointermove
// type carries clientX and still triggers React's onPointerMove handler.
function pointerMove(container: HTMLElement, clientX: number) {
  fireEvent(container, new MouseEvent("pointermove", { bubbles: true, clientX }));
}

describe("PriceCurve", () => {
  it("shows no hover marker until the pointer moves over the chart", () => {
    renderCurve();

    expect(screen.queryByText("75%")).not.toBeInTheDocument();
  });

  it("snaps hover to the nearest point and shows its percent and time", () => {
    const container = renderCurve();

    // 300px wide, 4 points: x=290 is nearest the final point (75 cents).
    pointerMove(container, 290);

    expect(screen.getByText("75%")).toBeInTheDocument();
    // Intraday span, so the label includes the time of day.
    expect(screen.getByText(/Jun 13/)).toBeInTheDocument();
  });

  it("moves the readout as the pointer crosses point boundaries", () => {
    const container = renderCurve();

    pointerMove(container, 110); // nearest index 1 -> 60 cents
    expect(screen.getByText("60%")).toBeInTheDocument();

    pointerMove(container, 190); // nearest index 2 -> 40 cents
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
  });

  it("clears the hover marker when the pointer leaves", () => {
    const container = renderCurve();

    pointerMove(container, 290);
    expect(screen.getByText("75%")).toBeInTheDocument();

    fireEvent.pointerLeave(container);
    expect(screen.queryByText("75%")).not.toBeInTheDocument();
  });

  it("omits the time label when points carry no timestamps", () => {
    const container = renderCurve([{ cents: 50 }, { cents: 62 }]);

    pointerMove(container, 290);

    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.queryByText(/Jun/)).not.toBeInTheDocument();
  });

  it("ignores hover on single-point paths", () => {
    const container = renderCurve([{ cents: 50 }]);

    pointerMove(container, 150);

    expect(screen.queryByText("50%")).not.toBeInTheDocument();
  });
});
