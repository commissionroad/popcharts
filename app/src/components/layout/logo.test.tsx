import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Logo } from "./logo";

describe("Logo", () => {
  it("shows the Pop Charts wordmark", () => {
    render(<Logo />);

    expect(screen.getByText("Pop")).toBeInTheDocument();
    expect(screen.getByText("Charts")).toBeInTheDocument();
  });

  it("renders the brand glyph as a decorative image", () => {
    render(<Logo />);
    const glyph = document.querySelector("img");

    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("alt", "");
    expect(glyph?.getAttribute("src")).toContain("pop-charts-glyph");
  });
});
