import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  formatDeadline,
  toDateTimeLocalValue,
} from "@/domain/market-creation/create-market";

import { formatDeadlineFromSeconds, ReviewRow } from "./shared";

describe("ReviewRow", () => {
  it("renders the label and value", () => {
    render(<ReviewRow label="Question" value="Will it pop?" />);

    expect(screen.getByText("Question")).toBeInTheDocument();

    const value = screen.getByText("Will it pop?");

    expect(value).toBeInTheDocument();
    expect(value).not.toHaveClass("font-mono");
  });

  it("renders mono values in the break-all monospace style", () => {
    render(<ReviewRow label="Metadata hash" mono value="0xabc123" />);

    expect(screen.getByText("0xabc123")).toHaveClass("font-mono", "break-all");
  });
});

describe("formatDeadlineFromSeconds", () => {
  it("formats an epoch-seconds deadline like the draft form deadline", () => {
    const seconds = 1_909_137_600n; // 2030-07-01T12:00:00Z
    const expected = formatDeadline(
      toDateTimeLocalValue(new Date(Number(seconds) * 1000))
    );

    render(<div>{formatDeadlineFromSeconds(seconds)}</div>);

    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
