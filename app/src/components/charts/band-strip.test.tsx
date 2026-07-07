import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BandStrip } from "./band-strip";

describe("BandStrip", () => {
  it("renders all ten decile cells", () => {
    render(<BandStrip />);

    for (let decile = 0; decile < 10; decile += 1) {
      expect(screen.getByText(String(decile * 10))).toBeInTheDocument();
    }
  });

  it("colors matched, one-sided, and empty deciles differently", () => {
    render(<BandStrip />);

    // YES demand spans 20-70 and NO demand spans 40-90, so 40-70 is matched.
    expect(decileCell("40").getAttribute("style")).toContain("var(--status-graduated)");
    expect(decileCell("20").getAttribute("style")).toContain("var(--yes-wash)");
    expect(decileCell("70").getAttribute("style")).toContain("var(--no-wash)");
    expect(decileCell("0").getAttribute("style")).toContain("var(--surface-raised)");
    // The 90-100 band only touches NO demand at its 90 boundary, which does
    // not count as overlap.
    expect(decileCell("90").getAttribute("style")).toContain("var(--surface-raised)");
  });

  it("glows matched cells and inks their labels for contrast", () => {
    render(<BandStrip />);

    expect(decileCell("50").getAttribute("style")).toContain("inset 0 0 18px");
    expect(screen.getByText("50").getAttribute("style")).toContain("var(--pc-ink)");
    expect(decileCell("0").getAttribute("style")).toContain("none");
    expect(screen.getByText("0").getAttribute("style")).toContain("var(--text-muted)");
  });

  it("explains the palette in the legend", () => {
    render(<BandStrip />);

    expect(screen.getByText("Matched to complete sets")).toBeInTheDocument();
    expect(screen.getByText("YES only refunds")).toBeInTheDocument();
    expect(screen.getByText("NO only refunds")).toBeInTheDocument();
    expect(screen.getByText("No demand")).toBeInTheDocument();
  });
});

function decileCell(label: string): HTMLElement {
  const cell = screen.getByText(label).parentElement;

  if (!cell) {
    throw new Error(`decile cell missing for ${label}`);
  }

  return cell;
}
