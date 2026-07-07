import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MARKET_CATEGORIES } from "@/domain/markets/types";

import { CategoryPicker, DeadlineControl } from "./create-market-fields";

describe("CategoryPicker", () => {
  it("renders every category and marks the current one pressed", () => {
    render(<CategoryPicker category="Sports" onChange={vi.fn()} />);

    for (const category of MARKET_CATEGORIES) {
      expect(screen.getByRole("button", { name: category })).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: "Sports" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Crypto" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports the picked category", () => {
    const onChange = vi.fn();

    render(<CategoryPicker category="Sports" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Weather" }));

    expect(onChange).toHaveBeenCalledWith("Weather");
  });

  it("renders the category validation error", () => {
    render(
      <CategoryPicker category="Sports" error="Pick a category." onChange={vi.fn()} />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Pick a category.");
  });
});

describe("DeadlineControl", () => {
  it("renders the datetime field, presets, and custom marker", () => {
    render(deadlineControl({ selectedPreset: "custom" }));

    expect(screen.getByLabelText("Graduation deadline")).toHaveValue(
      "2030-07-01T12:00"
    );
    expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByText("Custom")).toHaveAttribute("aria-current", "true");
  });

  it("marks the active preset and leaves the custom marker unset", () => {
    render(deadlineControl({ selectedPreset: "6h" }));

    expect(screen.getByRole("button", { name: "6h" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Custom")).not.toHaveAttribute("aria-current");
  });

  it("reports manual edits with the raw input value", () => {
    const onChange = vi.fn();

    render(deadlineControl({ onChange }));

    fireEvent.change(screen.getByLabelText("Graduation deadline"), {
      target: { value: "2030-08-01T09:30" },
    });

    expect(onChange).toHaveBeenCalledWith("2030-08-01T09:30");
  });

  it("reports the full preset when a quick pick is chosen", () => {
    const onPreset = vi.fn();

    render(deadlineControl({ onPreset }));

    fireEvent.click(screen.getByRole("button", { name: "24h" }));

    expect(onPreset).toHaveBeenCalledWith({
      label: "24h",
      milliseconds: 24 * 60 * 60 * 1000,
    });
  });

  it("renders the deadline validation error", () => {
    render(deadlineControl({ error: "Deadline must be in the future." }));

    expect(screen.getByText("Deadline must be in the future.")).toBeInTheDocument();
  });
});

const testPresets = [
  { label: "1h", milliseconds: 60 * 60 * 1000 },
  { label: "6h", milliseconds: 6 * 60 * 60 * 1000 },
  { label: "24h", milliseconds: 24 * 60 * 60 * 1000 },
] as const;

function deadlineControl(
  overrides: Partial<Parameters<typeof DeadlineControl>[0]> = {}
) {
  return (
    <DeadlineControl
      id="graduation-time"
      label="Graduation deadline"
      onChange={vi.fn()}
      onPreset={vi.fn()}
      presets={testPresets}
      selectedPreset="1h"
      value="2030-07-01T12:00"
      {...overrides}
    />
  );
}
