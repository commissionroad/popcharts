import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MarketSide, PricePathPoint } from "@/domain/markets/types";

import { PriceCurve } from "./price-curve";

// Companion to price-curve.test.tsx: covers only the branches the main suite
// leaves out (NO side, unmeasured layout, and time-label edge cases).
describe("PriceCurve edge branches", () => {
  it("renders the NO side with a working hover readout", () => {
    const container = renderCurve([{ cents: 30 }, { cents: 45 }], "no");

    pointerMove(container, 290);

    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("ignores pointer movement while the chart has no measured width", () => {
    const container = renderCurve([{ cents: 30 }, { cents: 45 }], "yes", 0);

    pointerMove(container, 150);

    expect(screen.queryByText("30%")).not.toBeInTheDocument();
    expect(screen.queryByText("45%")).not.toBeInTheDocument();
  });

  it("omits the time label when the hovered timestamp cannot be parsed", () => {
    const container = renderCurve([
      { at: "not-a-date", cents: 50 },
      { at: "also-not-a-date", cents: 62 },
    ]);

    pointerMove(container, 290);

    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.queryByText(/[A-Z][a-z]{2} \d/)).not.toBeInTheDocument();
  });

  it("skips points without timestamps when computing the intraday span", () => {
    const container = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
      { cents: 55 },
      { at: "2026-06-13T13:00:00.000Z", cents: 62 },
    ]);

    pointerMove(container, 290);

    expect(screen.getByText("62%")).toBeInTheDocument();
    // The two dated points sit an hour apart, so the label keeps the time.
    expect(screen.getByText(/Jun 13.*\d{1,2}:\d{2}/)).toBeInTheDocument();
  });

  it("drops the time of day once the path spans multiple days", () => {
    const container = renderCurve([
      { at: "2026-06-13T12:00:00.000Z", cents: 50 },
      { at: "2026-06-16T12:00:00.000Z", cents: 62 },
    ]);

    pointerMove(container, 290);

    expect(screen.getByText("Jun 16")).toBeInTheDocument();
    expect(screen.queryByText(/\d{1,2}:\d{2}/)).not.toBeInTheDocument();
  });
});

function renderCurve(points: PricePathPoint[], side: MarketSide = "yes", width = 300) {
  render(<PriceCurve points={points} side={side} />);
  const container = screen.getByTestId("price-curve");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    bottom: 150,
    height: 150,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
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
