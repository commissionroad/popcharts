import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GraduationBar } from "./graduation-bar";

describe("GraduationBar", () => {
  it("captions progress toward the graduation target", () => {
    render(<GraduationBar matchedUsd={25_000} targetUsd={100_000} />);

    expect(screen.getByText("GRADUATION")).toBeInTheDocument();
    expect(screen.getByText("$25K")).toBeInTheDocument();
    expect(screen.getByText("/ $100K matched")).toBeInTheDocument();
    expect(barFill()).toHaveStyle({ width: "25%" });
    expect(barFill()).toHaveStyle({ background: "var(--status-graduating)" });
  });

  it("switches to ready styling once the target is matched", () => {
    render(<GraduationBar matchedUsd={100_000} targetUsd={100_000} />);

    expect(screen.getByText("READY TO GRADUATE")).toBeInTheDocument();
    expect(barFill()).toHaveStyle({ width: "100%" });
    expect(barFill()).toHaveStyle({ background: "var(--status-graduated)" });
  });

  it("caps overflow above the target at full width", () => {
    render(<GraduationBar matchedUsd={480_000} targetUsd={100_000} />);

    expect(screen.getByText("READY TO GRADUATE")).toBeInTheDocument();
    expect(barFill()).toHaveStyle({ width: "100%" });
  });

  it("clamps negative matched amounts to an empty bar", () => {
    render(<GraduationBar matchedUsd={-50} targetUsd={100_000} />);

    expect(barFill()).toHaveStyle({ width: "0%" });
    expect(screen.getByText("GRADUATION")).toBeInTheDocument();
  });

  it("hides the caption and honors a custom height when asked", () => {
    render(
      <GraduationBar
        height={12}
        matchedUsd={25_000}
        showCaption={false}
        targetUsd={100_000}
      />
    );

    expect(screen.queryByText("GRADUATION")).not.toBeInTheDocument();
    expect(screen.queryByText("/ $100K matched")).not.toBeInTheDocument();
    expect(barTrack()).toHaveStyle({ height: "12px" });
  });
});

function barTrack(): HTMLElement {
  const fill = barFill();

  if (!fill.parentElement) {
    throw new Error("bar track missing");
  }

  return fill.parentElement;
}

function barFill(): HTMLElement {
  const fill = document.querySelector<HTMLElement>('div[style*="width"]');

  if (!fill) {
    throw new Error("bar fill missing");
  }

  return fill;
}
