import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MARKET_CATEGORIES } from "@/domain/markets/types";

import { CategoryFilterChips } from "./category-filter-chips";

describe("CategoryFilterChips", () => {
  it("treats All as the empty selection", () => {
    render(<CategoryFilterChips onClear={vi.fn()} onToggle={vi.fn()} selected={[]} />);

    expect(
      screen.getByRole("button", { name: "All categories", pressed: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crypto", pressed: false })
    ).toBeInTheDocument();
  });

  it("offers every category the app knows about", () => {
    render(<CategoryFilterChips onClear={vi.fn()} onToggle={vi.fn()} selected={[]} />);

    for (const category of MARKET_CATEGORIES) {
      expect(screen.getByRole("button", { name: category })).toBeInTheDocument();
    }
  });

  it("marks every selected category, not just the last one clicked", () => {
    render(
      <CategoryFilterChips
        onClear={vi.fn()}
        onToggle={vi.fn()}
        selected={["Crypto", "Tech"]}
      />
    );

    expect(
      screen.getByRole("button", { name: "Crypto", pressed: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tech", pressed: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All categories", pressed: false })
    ).toBeInTheDocument();
  });

  it("reports a category click as a toggle", () => {
    const onToggle = vi.fn();
    render(
      <CategoryFilterChips
        onClear={vi.fn()}
        onToggle={onToggle}
        selected={["Crypto"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Crypto" }));

    expect(onToggle).toHaveBeenCalledWith("Crypto");
  });

  it("clears rather than selects when All is clicked", () => {
    const onClear = vi.fn();
    const onToggle = vi.fn();
    render(
      <CategoryFilterChips
        onClear={onClear}
        onToggle={onToggle}
        selected={["Crypto"]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "All categories" }));

    expect(onClear).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("names the group for assistive tech", () => {
    render(<CategoryFilterChips onClear={vi.fn()} onToggle={vi.fn()} selected={[]} />);

    expect(
      screen.getByRole("group", { name: "Filter by category" })
    ).toBeInTheDocument();
  });
});
