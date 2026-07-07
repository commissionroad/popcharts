import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OutcomeButton } from "./outcome-button";

describe("OutcomeButton", () => {
  it("renders a YES link with the rounded price", () => {
    render(<OutcomeButton href="/markets/m1?side=yes" priceCents={63.7} side="yes" />);
    const link = screen.getByRole("link");

    expect(link).toHaveAttribute("href", "/markets/m1?side=yes");
    expect(screen.getByText("YES")).toHaveStyle({ color: "var(--yes)" });
    expect(screen.getByText("64c")).toHaveStyle({ color: "var(--yes)" });
  });

  it("renders a NO tile without a link when no href is given", () => {
    render(<OutcomeButton priceCents={36} side="no" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("NO")).toHaveStyle({ color: "var(--no)" });
    expect(screen.getByText("36c")).toBeInTheDocument();
  });

  it("inverts the text onto the outcome color when selected", () => {
    render(<OutcomeButton priceCents={64} selected side="yes" />);

    expect(screen.getByText("YES")).toHaveStyle({ color: "var(--pc-ink)" });
    expect(screen.getByText("64c")).toHaveStyle({ color: "var(--pc-ink)" });
  });

  it("inverts a selected link the same way", () => {
    render(
      <OutcomeButton href="/markets/m1?side=no" priceCents={36} selected side="no" />
    );

    expect(screen.getByText("NO")).toHaveStyle({ color: "var(--pc-ink)" });
    expect(screen.getByText("36c")).toHaveStyle({ color: "var(--pc-ink)" });
  });

  it("shows the sub caption only when provided", () => {
    const { rerender } = render(
      <OutcomeButton priceCents={64} side="yes" sub="192 shares" />
    );

    expect(screen.getByText("192 shares")).toBeInTheDocument();

    rerender(<OutcomeButton priceCents={64} side="yes" />);

    expect(screen.queryByText("192 shares")).not.toBeInTheDocument();
  });

  it("shows a zero price as 0c", () => {
    render(<OutcomeButton priceCents={0} side="no" />);

    expect(screen.getByText("0c")).toBeInTheDocument();
  });
});
