import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReviewProgressPanel } from "./review-progress-panel";

describe("ReviewProgressPanel", () => {
  it("shows the in-progress review with the quoted question and steps", () => {
    render(<ReviewProgressPanel question="Will it pop?" />);

    expect(screen.getByText("AI review in progress")).toBeInTheDocument();
    expect(screen.getByText("Usually under a minute")).toBeInTheDocument();
    expect(screen.getByText("“Will it pop?”")).toBeInTheDocument();
    expect(screen.getByText("Reading the question")).toBeInTheDocument();
    expect(screen.getByText("Checking policy & safety")).toBeInTheDocument();
    expect(screen.getByText("Scoring resolvability")).toBeInTheDocument();
    expect(
      screen.getByText("Your draft is locked while the reviewer reads it")
    ).toBeInTheDocument();
  });
});
