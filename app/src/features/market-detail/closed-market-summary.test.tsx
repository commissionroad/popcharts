import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { ClosedMarketSummary } from "./closed-market-summary";

function closedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    closesAt: "2026-08-14T00:00:00.000Z",
    graduationTargetUsd: 12_500,
    id: "31337:7",
    matchedUsd: 3_140,
    receiptCount: 46,
    status: "refunded",
    volumeUsd: 4_820,
    ...overrides,
  });
}

describe("ClosedMarketSummary", () => {
  it("explains a market that ran out of time short of its target", () => {
    render(<ClosedMarketSummary market={closedMarket()} />);

    expect(screen.getByText("Closed without graduating")).toBeInTheDocument();
    expect(
      screen.getByText(/matched \$3,140 of its \$12,500 graduation target/)
    ).toBeInTheDocument();
  });

  it("reports the volume being returned, not the matched cost", () => {
    render(<ClosedMarketSummary market={closedMarket()} />);

    expect(screen.getByText("Refunding")).toBeInTheDocument();
    expect(screen.getByText("$4.8K")).toBeInTheDocument();
    expect(screen.getByText("46")).toBeInTheDocument();
    expect(screen.getByText("$12,500")).toBeInTheDocument();
  });

  it("dashes the target rather than claiming a $0 one the market never had", () => {
    render(<ClosedMarketSummary market={closedMarket({ graduationTargetUsd: 0 })} />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("explains an owner cancel as a withdrawal", () => {
    render(<ClosedMarketSummary market={closedMarket({ status: "cancelled" })} />);

    expect(screen.getByText("Cancelled before graduation")).toBeInTheDocument();
  });

  it("renders nothing for a postgrad draw, which redeems rather than refunds", () => {
    const { container } = render(
      <ClosedMarketSummary
        market={closedMarket({
          resolution: {
            kind: "cancelled",
            postgradMarket: "0x00000000000000000000000000000000000000f1",
            resolvedAt: "2026-08-20T00:00:00.000Z",
          },
          status: "cancelled",
        })}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a market that is still running", () => {
    const { container } = render(
      <ClosedMarketSummary market={closedMarket({ status: "bootstrap" })} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
