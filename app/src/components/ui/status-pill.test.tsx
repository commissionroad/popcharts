import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "./status-pill";

const PULSE_CLASS = "animate-[pc-pulse_1.8s_ease-in-out_infinite]";

describe("StatusPill", () => {
  it("labels the status with its display copy", () => {
    render(<StatusPill status="under_review" />);

    expect(screen.getByText("Under review")).toBeInTheDocument();
  });

  it("pulses the dot for live statuses", () => {
    render(<StatusPill status="bootstrap" />);

    expect(statusDot("Bootstrap")).toHaveClass(PULSE_CLASS);
  });

  it("keeps the dot still for settled statuses", () => {
    render(<StatusPill status="graduated" />);

    expect(statusDot("Graduated")).not.toHaveClass(PULSE_CLASS);
  });

  it("uses compact spacing for the small size", () => {
    render(<StatusPill size="sm" status="resolved" />);

    expect(screen.getByText("Resolved")).toHaveClass("text-[10px]");
  });

  it("uses roomier spacing by default", () => {
    render(<StatusPill status="refunded" />);

    expect(screen.getByText("Refunded")).toHaveClass("text-[11px]");
  });

  it("prefers a custom label over the status copy", () => {
    render(<StatusPill label="Live now" status="graduating" />);

    expect(screen.getByText("Live now")).toBeInTheDocument();
    expect(screen.queryByText("Graduating")).not.toBeInTheDocument();
  });
});

function statusDot(label: string): HTMLElement {
  const pill = screen.getByText(label);
  const dot = pill.querySelector("span");

  if (!dot) {
    throw new Error(`status dot missing for ${label}`);
  }

  return dot as HTMLElement;
}
