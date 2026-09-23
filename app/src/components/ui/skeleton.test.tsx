import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Skeleton,
  SkeletonChart,
  SkeletonMarketCard,
  SkeletonMetricCard,
  SkeletonRegion,
  SkeletonTableRows,
  SkeletonText,
} from "./skeleton";

/** Every placeholder shares the one shimmer class; count them by it. */
function placeholders(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".pc-skeleton"));
}

function firstPlaceholder(container: HTMLElement) {
  const [first] = placeholders(container);

  if (!first) {
    throw new Error("expected at least one skeleton placeholder");
  }

  return first as HTMLElement;
}

describe("Skeleton", () => {
  it("carries the shared shimmer class and the requested size", () => {
    const { container } = render(<Skeleton height={24} width="60%" />);
    const block = firstPlaceholder(container);

    expect(block).toHaveClass("pc-skeleton");
    expect(block.style.height).toBe("24px");
    expect(block.style.width).toBe("60%");
  });

  it("tints for the card ground by default", () => {
    const { container } = render(<Skeleton height={10} />);

    expect(
      firstPlaceholder(container).style.getPropertyValue("--pc-skeleton-tint")
    ).toBe("var(--surface-raised)");
  });

  it("tints one step down for a skeleton standing on page ink", () => {
    const { container } = render(<Skeleton ground="page" height={10} />);

    expect(
      firstPlaceholder(container).style.getPropertyValue("--pc-skeleton-tint")
    ).toBe("var(--surface-card)");
  });

  it.each([
    ["none", ""],
    ["sm", "rounded-[var(--radius-sm)]"],
    ["md", "rounded-[var(--radius-md)]"],
    ["lg", "rounded-[var(--radius-lg)]"],
    ["pill", "rounded-[var(--radius-pill)]"],
  ] as const)("renders the %s radius", (radius, expected) => {
    const { container } = render(<Skeleton height={10} radius={radius} />);
    const block = firstPlaceholder(container);

    if (expected) {
      expect(block).toHaveClass(expected);
    } else {
      expect(block.className).toBe("pc-skeleton");
    }
  });

  it("merges a caller className and lets a caller style win", () => {
    const { container } = render(
      <Skeleton className="flex-1" style={{ height: 99 }} height={10} />
    );
    const block = firstPlaceholder(container);

    expect(block).toHaveClass("flex-1");
    expect(block.style.height).toBe("99px");
  });

  it("is hidden from assistive tech — the region announces the wait instead", () => {
    const { container } = render(<Skeleton height={10} />);

    expect(firstPlaceholder(container)).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SkeletonText", () => {
  it("shortens the last line so a paragraph reads as one", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = placeholders(container) as HTMLElement[];

    expect(lines).toHaveLength(3);
    expect(lines[0]?.style.width).toBe("100%");
    expect(lines[1]?.style.width).toBe("100%");
    expect(lines[2]?.style.width).toBe("62%");
  });

  it("keeps a single line full width — one short bar is not a paragraph", () => {
    const { container } = render(<SkeletonText lines={1} />);
    const lines = placeholders(container) as HTMLElement[];

    expect(lines).toHaveLength(1);
    expect(lines[0]?.style.width).toBe("100%");
  });

  it("takes the line height and gap from the type it replaces", () => {
    const { container } = render(
      <SkeletonText gap={4} lastLineWidth="40%" lineHeight={18} lines={2} />
    );
    const lines = placeholders(container) as HTMLElement[];

    expect(lines[0]?.style.height).toBe("18px");
    expect(lines[1]?.style.width).toBe("40%");
    expect((container.firstElementChild as HTMLElement).style.gap).toBe("4px");
  });
});

describe("SkeletonMetricCard", () => {
  it("draws the card chrome and shimmers only the unknown contents", () => {
    const { container } = render(<SkeletonMetricCard />);

    expect(container.firstElementChild).toHaveClass("bg-[var(--surface-card)]");
    expect(placeholders(container)).toHaveLength(3);
  });
});

describe("SkeletonMarketCard", () => {
  it("reuses the market card's own height constraints so the grid can't jump", () => {
    const { container } = render(<SkeletonMarketCard />);
    const card = container.firstElementChild as HTMLElement;

    expect(card).toHaveClass("min-h-[360px]");
    expect(card.querySelector(".min-h-\\[76px\\]")).not.toBeNull();
  });

  it("stands in for both outcome cells", () => {
    const { container } = render(<SkeletonMarketCard />);

    expect(container.querySelectorAll(".flex-1.flex-col")).toHaveLength(2);
  });
});

describe("SkeletonTableRows", () => {
  it("derives its cell count from the grid template it is given", () => {
    const { container } = render(
      <SkeletonTableRows columns="1.4fr 0.4fr 0.5fr 0.9fr" rows={2} />
    );
    const rows = Array.from(container.querySelectorAll(".grid")) as HTMLElement[];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.style.gridTemplateColumns).toBe("1.4fr 0.4fr 0.5fr 0.9fr");
    expect(placeholders(container)).toHaveLength(8);
  });

  it("gives the first column the long name width and the rest a figure width", () => {
    const { container } = render(<SkeletonTableRows columns="1fr 1fr" rows={1} />);
    const cells = placeholders(container) as HTMLElement[];

    expect(cells[0]?.style.width).toBe("80%");
    expect(cells[1]?.style.width).toBe("58%");
  });

  it("defaults to three rows", () => {
    const { container } = render(<SkeletonTableRows columns="1fr" />);

    expect(container.querySelectorAll(".grid")).toHaveLength(3);
  });

  it("tolerates a template with padded whitespace", () => {
    const { container } = render(
      <SkeletonTableRows columns="  1fr   2fr  " rows={1} />
    );

    expect(placeholders(container)).toHaveLength(2);
  });
});

describe("SkeletonChart", () => {
  it("draws the real gridlines and shimmers only the plotted series", () => {
    const { container } = render(<SkeletonChart />);

    expect(container.querySelectorAll(".border-dotted")).toHaveLength(3);
    expect(container.querySelector(".h-\\[170px\\]")).not.toBeNull();
  });
});

describe("SkeletonRegion", () => {
  it("announces the wait once, and marks the region busy", () => {
    render(
      <SkeletonRegion label="Loading your receipts">
        <SkeletonMarketCard />
      </SkeletonRegion>
    );

    const region = screen.getByRole("status");

    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading your receipts")).toHaveClass("sr-only");
  });

  it("passes a className through for layout", () => {
    render(
      <SkeletonRegion className="grid gap-4" label="Loading">
        <span />
      </SkeletonRegion>
    );

    expect(screen.getByRole("status")).toHaveClass("grid");
  });
});
