import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarketSearchField } from "./market-search-field";

function renderField(props: Partial<Parameters<typeof MarketSearchField>[0]> = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();

  render(
    <MarketSearchField onChange={onChange} onClear={onClear} value="" {...props} />
  );

  return { onChange, onClear };
}

describe("MarketSearchField", () => {
  it("reports what the user types without holding the query itself", () => {
    const { onChange } = renderField();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search markets" }), {
      target: { value: "fed" },
    });

    expect(onChange).toHaveBeenCalledWith("fed");
  });

  it("offers no clear button until there is something to clear", () => {
    renderField();

    expect(
      screen.queryByRole("button", { name: "Clear search" })
    ).not.toBeInTheDocument();
  });

  it("clears through the caller once the field has a query", () => {
    const { onClear } = renderField({ value: "fed" });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onClear).toHaveBeenCalledOnce();
  });

  it("replaces the clear button with the spinner while a search is in flight", () => {
    const { container } = render(
      <MarketSearchField
        onChange={vi.fn()}
        onClear={vi.fn()}
        state="loading"
        value="fed"
      />
    );

    expect(
      screen.queryByRole("button", { name: "Clear search" })
    ).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("keeps the query editable when the search failed, and marks the field", () => {
    const { container } = render(
      <MarketSearchField
        onChange={vi.fn()}
        onClear={vi.fn()}
        state="error"
        value="fed"
      />
    );

    expect(screen.getByRole("searchbox")).toHaveValue("fed");
    expect(
      container.querySelector(".border-\\[var\\(--no-border\\)\\]")
    ).toBeInTheDocument();
  });

  it("accepts a caller-supplied id and placeholder", () => {
    render(
      <MarketSearchField
        id="board-search"
        onChange={vi.fn()}
        onClear={vi.fn()}
        placeholder="Find a question"
        value=""
      />
    );

    expect(screen.getByRole("searchbox")).toHaveAttribute("id", "board-search");
    expect(screen.getByPlaceholderText("Find a question")).toBeInTheDocument();
  });
});
