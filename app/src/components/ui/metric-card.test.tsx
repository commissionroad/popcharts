import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "./metric-card";

describe("MetricCard", () => {
  it("shows the label and value", () => {
    render(<MetricCard label="Matched" value="$356K" />);

    expect(screen.getByText("Matched")).toBeInTheDocument();
    expect(screen.getByText("$356K")).toBeInTheDocument();
  });

  it("colors the value with the default tone when none is given", () => {
    render(<MetricCard label="Matched" value="$356K" />);

    expect(screen.getByText("$356K")).toHaveStyle({
      color: "var(--text-primary)",
    });
  });

  it("renders an icon tinted with the custom tone", () => {
    render(
      <MetricCard
        icon={<span data-testid="metric-icon" />}
        label="Volume"
        tone="var(--pc-cyan)"
        value="$482K"
      />
    );
    const iconWrap = screen.getByTestId("metric-icon").parentElement;

    expect(iconWrap).toHaveStyle({ color: "var(--pc-cyan)" });
    expect(screen.getByText("$482K")).toHaveStyle({ color: "var(--pc-cyan)" });
  });

  it("omits the icon slot when no icon is given", () => {
    const { container } = render(<MetricCard label="Volume" value="$482K" />);

    expect(container.querySelectorAll("div")).toHaveLength(4);
  });
});
