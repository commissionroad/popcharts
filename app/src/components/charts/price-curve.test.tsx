import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PostgradPricePoint, PricePathPoint } from "@/domain/markets/types";

import { PriceCurve, toCurvePoints, windowPricePath } from "./price-curve";

const HOUR_MS = 60 * 60 * 1000;

const points: PricePathPoint[] = [
  { at: "2026-06-13T12:00:00.000Z", cents: 50 },
  { at: "2026-06-13T12:05:00.000Z", cents: 60 },
  { at: "2026-06-13T12:10:00.000Z", cents: 40 },
  { at: "2026-06-13T12:15:00.000Z", cents: 75 },
];

function renderCurve(
  pathPoints: PricePathPoint[] = points,
  props: Partial<ComponentProps<typeof PriceCurve>> = {}
) {
  render(<PriceCurve points={pathPoints} {...props} />);
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

describe("toCurvePoints", () => {
  it("infers the pre-graduation complement and keeps venue prices as observed", () => {
    expect(
      toCurvePoints({
        points: [{ at: "2026-06-13T12:00:00.000Z", cents: 40 }],
        postgradPoints: [{ at: "2026-06-13T13:00:00.000Z", noCents: 44, yesCents: 58 }],
      })
    ).toEqual([
      {
        at: "2026-06-13T12:00:00.000Z",
        noCents: 60,
        phase: "pregrad",
        yesCents: 40,
      },
      {
        at: "2026-06-13T13:00:00.000Z",
        noCents: 44,
        phase: "postgrad",
        yesCents: 58,
      },
    ]);
  });

  it("omits the timestamp of an untimed fixture point", () => {
    expect(toCurvePoints({ points: [{ cents: 40 }] })).toEqual([
      { noCents: 60, phase: "pregrad", yesCents: 40 },
    ]);
  });
});

describe("windowPricePath", () => {
  const now = Date.parse("2026-06-13T12:00:00.000Z");
  const timed = toCurvePoints({
    points: [
      { at: new Date(now - 72 * HOUR_MS).toISOString(), cents: 30 },
      { at: new Date(now - 2 * HOUR_MS).toISOString(), cents: 40 },
      { at: new Date(now - HOUR_MS / 2).toISOString(), cents: 60 },
      { at: new Date(now).toISOString(), cents: 70 },
    ],
  });

  it("spans the full history for the ALL range", () => {
    const { samples, timeSpan } = windowPricePath(timed, null);

    expect(samples).toHaveLength(4);
    expect(samples[0]).toMatchObject({ x: 0, yesCents: 30 });
    expect(samples.at(-1)).toMatchObject({ x: 1, yesCents: 70 });
    expect(timeSpan).toEqual({ spanMs: 72 * HOUR_MS, startMs: now - 72 * HOUR_MS });
  });

  it("keeps only the trailing window and anchors the standing price", () => {
    const { samples } = windowPricePath(timed, HOUR_MS);

    // The anchor carries the price standing at the window start (the 40-cent
    // sample from two hours ago), then the two in-window samples follow.
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({ x: 0, yesCents: 40 });
    expect(samples[1]).toMatchObject({ x: 0.5, yesCents: 60 });
    expect(samples.at(-1)).toMatchObject({ x: 1, yesCents: 70 });
  });

  it("clamps windows longer than the history to the full span", () => {
    const all = windowPricePath(timed, null);
    const month = windowPricePath(timed, 30 * 24 * HOUR_MS);

    expect(month).toEqual(all);
  });

  it("falls back to even spacing when timestamps are missing", () => {
    const { samples, timeSpan } = windowPricePath(
      toCurvePoints({ points: [{ cents: 50 }, { cents: 62 }] }),
      HOUR_MS
    );

    expect(samples).toEqual([
      { atMs: null, noCents: 50, phase: "pregrad", x: 0, yesCents: 50 },
      { atMs: null, noCents: 38, phase: "pregrad", x: 1, yesCents: 62 },
    ]);
    // Without a time axis there is nothing to place a dated annotation on.
    expect(timeSpan).toBeNull();
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

describe("PriceCurve across graduation", () => {
  const postgradPoints: PostgradPricePoint[] = [
    { at: "2026-06-13T12:30:00.000Z", noCents: 26, yesCents: 78 },
    { at: "2026-06-13T12:45:00.000Z", noCents: 20, yesCents: 82 },
  ];
  // Between the last receipt (12:15) and the first venue swap (12:30).
  const graduatedAt = "2026-06-13T12:20:00.000Z";

  it("marks graduation and shades the venue half of the window", () => {
    renderCurve(points, { graduatedAt, postgradPoints });

    const marker = screen.getByTestId("graduation-marker");
    expect(within(marker).getByText("Graduated")).toBeInTheDocument();
    // 12:00 to 12:45 is a 45-minute window; graduation lands 20 minutes in.
    expect(screen.getByTestId("postgrad-region")).toHaveStyle({
      left: `${(20 / 45) * 100}%`,
    });
  });

  it("plots each venue pool's own price instead of a complement", () => {
    // The pools price independently, so the readout is 82/20 — not 82/18.
    renderCurve(points, { graduatedAt, postgradPoints });

    expect(screen.getByTestId("legend-yes-value")).toHaveTextContent("82%");
    expect(screen.getByTestId("legend-no-value")).toHaveTextContent("20%");
  });

  it("reports the complete-set price on a venue sample only", () => {
    const plot = renderCurve(points, { graduatedAt, postgradPoints });

    pointerMove(plot, 290);
    expect(
      within(screen.getByTestId("crosshair")).getByText("102%")
    ).toBeInTheDocument();

    // A pre-graduation sample has no independent pair to sum.
    pointerMove(plot, 0);
    expect(
      within(screen.getByTestId("crosshair")).queryByText("Set")
    ).not.toBeInTheDocument();
  });

  it("keeps the rule in view while the window still opens pre-graduation", () => {
    renderCurve(points, { graduatedAt, postgradPoints });

    fireEvent.click(screen.getByRole("button", { name: "1H" }));

    expect(screen.getByTestId("graduation-marker")).toBeInTheDocument();
  });

  it("shades the whole window without a rule once graduation predates it", () => {
    renderCurve(points, {
      graduatedAt: "2026-06-13T11:00:00.000Z",
      postgradPoints,
    });

    expect(screen.queryByTestId("graduation-marker")).not.toBeInTheDocument();
    expect(screen.getByTestId("postgrad-region")).toHaveStyle({ left: "0%" });
  });

  it("marks a graduation inside the window even with no venue prices yet", () => {
    renderCurve(points, { graduatedAt: "2026-06-13T12:10:00.000Z" });

    expect(screen.getByTestId("graduation-marker")).toBeInTheDocument();
    expect(screen.getByTestId("postgrad-region")).toBeInTheDocument();
  });

  it("drops the marker off the axis once receipts stop at graduation", () => {
    // The real no-venue-trades-yet state: receipts end before graduation, so
    // the window closes ahead of it and there is no x to place the rule at.
    renderCurve(points, { graduatedAt: "2026-06-13T12:18:00.000Z" });

    expect(screen.queryByTestId("graduation-marker")).not.toBeInTheDocument();
  });

  it("flips the graduation label inward near the right edge", () => {
    renderCurve(points, { graduatedAt: "2026-06-13T12:14:00.000Z" });

    const label = within(screen.getByTestId("graduation-marker")).getByText(
      "Graduated"
    );
    expect(label).toHaveStyle({ transform: "translateX(calc(-100% - 4px))" });
  });

  it("omits the marker when graduation postdates every plotted sample", () => {
    renderCurve(points, { graduatedAt: "2026-06-14T12:00:00.000Z" });

    expect(screen.queryByTestId("graduation-marker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("postgrad-region")).not.toBeInTheDocument();
  });

  it("omits the marker when the graduation time cannot be parsed", () => {
    renderCurve(points, { graduatedAt: "not-a-date" });

    expect(screen.queryByTestId("graduation-marker")).not.toBeInTheDocument();
  });

  it("omits the marker on an untimed path, which has no axis to place it on", () => {
    renderCurve([{ cents: 50 }, { cents: 62 }], { graduatedAt });

    expect(screen.queryByTestId("graduation-marker")).not.toBeInTheDocument();
  });
});
