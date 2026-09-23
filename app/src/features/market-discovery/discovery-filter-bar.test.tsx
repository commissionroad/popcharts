import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiscoveryFilterBar, summaryLabel } from "./discovery-filter-bar";

function renderBar(props: Partial<Parameters<typeof DiscoveryFilterBar>[0]> = {}) {
  const handlers = {
    onCategoriesClear: vi.fn(),
    onCategoryToggle: vi.fn(),
    onClearAll: vi.fn(),
    onQueryChange: vi.fn(),
    onQueryClear: vi.fn(),
    onStatusChange: vi.fn(),
  };

  render(
    <DiscoveryFilterBar
      categories={[]}
      query=""
      resultCount={9}
      {...handlers}
      {...props}
    />
  );

  return handlers;
}

describe("DiscoveryFilterBar", () => {
  it("stays two rows while nothing is filtered", () => {
    renderBar();

    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Filter by category" })
    ).toBeInTheDocument();
  });

  it("earns the summary strip with a query", () => {
    renderBar({ query: "fed", resultCount: 2 });

    expect(screen.getByText("2 markets · matching “fed”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("earns the summary strip with categories alone", () => {
    renderBar({ categories: ["Crypto", "Tech"], resultCount: 3 });

    expect(screen.getByText("3 markets · in Crypto, Tech")).toBeInTheDocument();
  });

  it("earns the summary strip with a non-default status alone", () => {
    renderBar({ resultCount: 1, statusKey: "graduated" });

    expect(screen.getByText("1 market · Graduated")).toBeInTheDocument();
  });

  it("ignores whitespace-only queries when deciding it is filtered", () => {
    renderBar({ query: "   " });

    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("resets everything through one button", () => {
    const { onClearAll } = renderBar({ query: "fed" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("passes the search field's edits straight through", () => {
    const { onQueryChange, onQueryClear } = renderBar({ query: "fed" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fedd" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onQueryChange).toHaveBeenCalledWith("fedd");
    expect(onQueryClear).toHaveBeenCalledOnce();
  });

  it("passes category and status changes through", () => {
    const { onCategoriesClear, onCategoryToggle, onStatusChange } = renderBar();

    fireEvent.click(screen.getByRole("button", { name: "Sports" }));
    fireEvent.click(screen.getByRole("button", { name: "Graduating" }));
    fireEvent.click(screen.getByRole("button", { name: "All categories" }));

    expect(onCategoryToggle).toHaveBeenCalledWith("Sports");
    expect(onStatusChange).toHaveBeenCalledWith("graduating");
    expect(onCategoriesClear).toHaveBeenCalledOnce();
  });

  it("renders the in-flight search state in the field", () => {
    const { container } = render(
      <DiscoveryFilterBar
        categories={[]}
        onCategoriesClear={vi.fn()}
        onCategoryToggle={vi.fn()}
        onClearAll={vi.fn()}
        onQueryChange={vi.fn()}
        onQueryClear={vi.fn()}
        onStatusChange={vi.fn()}
        query="fed"
        resultCount={null}
        searchState="loading"
        statusKey="all"
      />
    );

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.getByText("Searching… · matching “fed”")).toBeInTheDocument();
  });
});

describe("summaryLabel", () => {
  const base = {
    categories: [] as const,
    query: "",
    resultCount: 4,
    searchState: "idle" as const,
    statusKey: "all",
  };

  it("counts markets, with the singular spelled out", () => {
    expect(summaryLabel({ ...base, resultCount: 0 })).toBe("No markets");
    expect(summaryLabel({ ...base, resultCount: 1 })).toBe("1 market");
    expect(summaryLabel({ ...base })).toBe("4 markets");
  });

  it("names every active filter in one line", () => {
    expect(
      summaryLabel({
        ...base,
        categories: ["Econ", "Politics"],
        query: " fed ",
        statusKey: "pre-grad",
      })
    ).toBe("4 markets · matching “fed” · in Econ, Politics · Pre-grad");
  });

  it("reports no count while the search is in flight", () => {
    expect(summaryLabel({ ...base, resultCount: null, searchState: "loading" })).toBe(
      "Searching…"
    );
  });

  it("reports no count when the search failed", () => {
    expect(summaryLabel({ ...base, searchState: "error" })).toBe("Results unavailable");
  });

  it("reports no count when the caller has no number to give", () => {
    expect(summaryLabel({ ...base, resultCount: null })).toBe("Results unavailable");
  });

  it("says nothing about a status key it does not recognise", () => {
    expect(summaryLabel({ ...base, statusKey: "from-an-old-link" })).toBe("4 markets");
  });
});
