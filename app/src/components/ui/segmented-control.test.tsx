import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl, type SegmentOption } from "./segmented-control";

const SELECTED_CLASS = "bg-[var(--segment-accent)]";

describe("SegmentedControl", () => {
  it("highlights the selected option and reports clicks on the others", () => {
    const onChange = vi.fn();
    render(<SegmentedControl onChange={onChange} options={sides()} value="yes" />);

    expect(screen.getByRole("button", { name: "YES" })).toHaveClass(SELECTED_CLASS);
    expect(screen.getByRole("button", { name: "NO" })).not.toHaveClass(SELECTED_CLASS);

    fireEvent.click(screen.getByRole("button", { name: "NO" }));

    expect(onChange).toHaveBeenCalledWith("no");
  });

  it("exposes the selection to assistive tech, not just by color", () => {
    render(<SegmentedControl onChange={vi.fn()} options={sides()} value="yes" />);

    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "YES", pressed: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "NO", pressed: false })
    ).toBeInTheDocument();
  });

  it("still reports a click on the already selected option", () => {
    const onChange = vi.fn();
    render(<SegmentedControl onChange={onChange} options={sides()} value="yes" />);

    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    expect(onChange).toHaveBeenCalledWith("yes");
  });

  it("uses the shared accent when no accentBy is given", () => {
    render(<SegmentedControl onChange={vi.fn()} options={sides()} value="yes" />);

    expect(screen.getByRole("button", { name: "YES" }).getAttribute("style")).toContain(
      "var(--accent)"
    );
  });

  it("colors each option through accentBy", () => {
    render(
      <SegmentedControl
        accentBy={(value) => (value === "yes" ? "var(--yes)" : "var(--no)")}
        onChange={vi.fn()}
        options={sides()}
        value="no"
      />
    );

    expect(screen.getByRole("button", { name: "YES" }).getAttribute("style")).toContain(
      "var(--yes)"
    );
    expect(screen.getByRole("button", { name: "NO" }).getAttribute("style")).toContain(
      "var(--no)"
    );
  });

  it("stretches across the full width when asked", () => {
    render(<SegmentedControl full onChange={vi.fn()} options={sides()} value="yes" />);
    const yes = screen.getByRole("button", { name: "YES" });

    expect(yes).toHaveClass("flex-1");
    expect(yes.parentElement).toHaveClass("w-full");
  });

  it("stays inline-sized by default", () => {
    render(<SegmentedControl onChange={vi.fn()} options={sides()} value="yes" />);
    const yes = screen.getByRole("button", { name: "YES" });

    expect(yes).not.toHaveClass("flex-1");
    expect(yes.parentElement).not.toHaveClass("w-full");
  });

  it("renders compact option sizing for the small size", () => {
    render(
      <SegmentedControl onChange={vi.fn()} options={sides()} size="sm" value="yes" />
    );

    expect(screen.getByRole("button", { name: "YES" })).toHaveClass("text-xs");
  });

  it("keeps every option a focusable non-submit button for keyboard use", () => {
    const onChange = vi.fn();
    render(<SegmentedControl onChange={onChange} options={sides()} value="yes" />);
    const no = screen.getByRole("button", { name: "NO" });

    expect(no).toHaveAttribute("type", "button");

    no.focus();

    expect(no).toHaveFocus();

    // jsdom does not synthesize click from Enter on buttons; activating the
    // focused element the way a keyboard would is a click event.
    fireEvent.click(no);

    expect(onChange).toHaveBeenCalledWith("no");
  });

  it("renders no options for an empty list", () => {
    render(<SegmentedControl onChange={vi.fn()} options={[]} value="yes" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

function sides(): SegmentOption[] {
  return [
    { label: "YES", value: "yes" },
    { label: "NO", value: "no" },
  ];
}
