import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { marketFactory } from "@/test/factories/markets";

import { GraduationPage } from "./graduation-page";

describe("GraduationPage", () => {
  it("renders the market question, clearing metrics, and back link", () => {
    render(
      <GraduationPage
        market={marketFactory({
          graduationTargetUsd: 482_000,
          id: "eth-5000-august",
          matchedUsd: 356_000,
          question: "Will ETH flip $5,000 before August?",
          receiptCount: 1_284,
          volumeUsd: 482_300,
        })}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Will ETH flip $5,000 before August?" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to market/ })).toHaveAttribute(
      "href",
      "/markets/eth-5000-august"
    );
    expect(screen.getByText("Matched market cap")).toBeInTheDocument();
    // Both the graduation bar and the matched metric show the matched cap.
    expect(screen.getAllByText("$356K")).not.toHaveLength(0);
    expect(screen.getByText("Complete sets minted")).toBeInTheDocument();
    expect(screen.getByText("356,000")).toBeInTheDocument();
    // Refunded unmatched = volume - matched.
    expect(screen.getByText("$126K")).toBeInTheDocument();
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Graduate market/ })).toBeInTheDocument();
  });

  it("clamps the refunded amount to zero when matched exceeds volume", () => {
    render(
      <GraduationPage
        market={marketFactory({ matchedUsd: 500_000, volumeUsd: 400_000 })}
      />
    );

    expect(screen.getByText("Refunded unmatched")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
  });
});
