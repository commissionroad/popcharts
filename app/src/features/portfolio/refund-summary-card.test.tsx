import type { PortfolioReceipt } from "@popcharts/api-client/models";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import { closedMarketRefunds } from "./refund-breakdown";
import { RefundSummaryCard } from "./refund-summary-card";

const CHAIN_ID = 31337;

function receipt(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    marketStatus: "refunded",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: "0",
    priceBandLow: "0",
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "refund_claimable",
    ...overrides,
  };
}

describe("RefundSummaryCard", () => {
  it("renders nothing when no market closed without graduating", () => {
    const { container } = render(<RefundSummaryCard refunds={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("totals what is still owed and links each market to its claim", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds(
          [
            receipt(),
            receipt({
              cost: (24n * WAD).toString(),
              marketId: "9",
              marketQuestion: "Ferry?",
              marketStatus: "cancelled",
              receiptId: "21",
            }),
          ],
          CHAIN_ID
        )}
      />
    );

    expect(screen.getByText("$84.00 to claim")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Will it pop\?/ })).toHaveAttribute(
      "href",
      "/markets/31337:7"
    );
    expect(screen.getByRole("link", { name: /Ferry\?/ })).toHaveAttribute(
      "href",
      "/markets/31337:9"
    );
  });

  it("gives each market its own reason for ending", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds(
          [
            receipt(),
            receipt({ marketId: "9", marketStatus: "cancelled", receiptId: "21" }),
          ],
          CHAIN_ID
        )}
      />
    );

    expect(screen.getByText(/closed without reaching graduation/)).toBeInTheDocument();
    expect(screen.getByText(/owner cancelled this market/)).toBeInTheDocument();
  });

  it("names the entry fee coming back when the paid fee is known", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds([receipt()], CHAIN_ID, {
          "11": ((60n * WAD) / 100n).toString(),
        })}
      />
    );

    expect(
      screen.getByText("Includes $0.60 of entry fees returned in full.")
    ).toBeInTheDocument();
    expect(screen.getByText("$60.60")).toBeInTheDocument();
  });

  it("omits the entry-fee line rather than printing a $0 fee when it is unknown", () => {
    render(<RefundSummaryCard refunds={closedMarketRefunds([receipt()], CHAIN_ID)} />);

    expect(screen.queryByText(/entry fees returned/)).not.toBeInTheDocument();
    expect(screen.getByText("Claim on the market page")).toBeInTheDocument();
  });

  it("omits the entry-fee line when the known fee is zero", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds([receipt()], CHAIN_ID, { "11": "0" })}
      />
    );

    expect(screen.queryByText(/entry fees returned/)).not.toBeInTheDocument();
  });

  it("becomes a record once everything on a market is claimed", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds(
          [
            receipt({
              settlement: {
                claimedAt: "2026-08-16T00:00:00.000Z",
                refund: (60n * WAD).toString(),
              },
              status: "refunded",
            }),
          ],
          CHAIN_ID
        )}
      />
    );

    expect(screen.queryByText(/to claim/)).not.toBeInTheDocument();
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    expect(screen.getByText("1 receipt refunded")).toBeInTheDocument();
  });

  it("pluralises the refunded-receipt count", () => {
    render(
      <RefundSummaryCard
        refunds={closedMarketRefunds(
          [
            receipt({ receiptId: "11", status: "refunded" }),
            receipt({ receiptId: "12", status: "refunded" }),
          ],
          CHAIN_ID
        )}
      />
    );

    expect(screen.getByText("2 receipts refunded")).toBeInTheDocument();
  });
});
