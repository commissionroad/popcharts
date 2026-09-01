import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WAD } from "@/domain/tokens/wad";

import { type PnlPositionRow, PositionPnlTable } from "./position-pnl-table";

describe("PositionPnlTable", () => {
  it("renders a profitable position's mark, value and unrealised gain", () => {
    render(<PositionPnlTable rows={[row()]} />);

    expect(screen.getByText("Will it pop?")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
    expect(screen.getByText("40c")).toBeInTheDocument();
    expect(screen.getByText("62c")).toBeInTheDocument();
    // Once on the row, once in the single-position summary beneath it.
    expect(screen.getAllByText("$62.00")).toHaveLength(2);
    expect(screen.getAllByText("+$22.00")).toHaveLength(3);
    // Once on the row, once as the single position's headline return.
    expect(screen.getAllByText("+55.0%")).toHaveLength(2);
  });

  it("falls back to the market id when the question is unknown", () => {
    const bare = row();
    delete bare.marketQuestion;

    render(<PositionPnlTable rows={[bare]} />);

    expect(screen.getByText("Market #7")).toBeInTheDocument();
  });

  it("labels a settled position with its outcome", () => {
    render(
      <PositionPnlTable
        rows={[
          row({
            costBasisWad: 0n,
            ownedTotalWad: 0n,
            realisedCostWad: (WAD * 7200n) / 100n,
            realisedProceedsWad: (WAD * 15000n) / 100n,
            standing: "won",
          }),
        ]}
      />
    );

    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getAllByText("+$78.00")).toHaveLength(3);
  });

  it("shows the fill count so an average entry is not read as one trade", () => {
    render(<PositionPnlTable rows={[row({ entryFillCount: 3 })]} />);

    expect(screen.getByText("3 fills")).toBeInTheDocument();
  });

  it("dashes an unpriced position rather than valuing it at zero", () => {
    render(<PositionPnlTable rows={[row({ markPriceWad: null })]} />);

    const positionRow = within(rowFor("Will it pop?"));

    // Mark, value and unrealised all dash out, and the unrealised cell says
    // why out loud rather than showing a $0.00 that would read as a wipeout.
    expect(positionRow.getAllByText("-")).toHaveLength(3);
    expect(positionRow.getByText("No price available")).toBeInTheDocument();
    // The one $0.00 left is realised P&L, which really is zero: nothing sold.
    expect(positionRow.getAllByText("$0.00")).toHaveLength(1);
  });

  it("aggregates a summary row across positions and flags unpriced ones", () => {
    render(
      <PositionPnlTable
        rows={[
          row(),
          row({
            id: "9:no",
            markPriceWad: null,
            marketQuestion: "Will the index close above 5,000?",
            side: "no",
          }),
        ]}
      />
    );

    expect(
      within(rowFor("All positions")).getByText(
        "2 positions - cost $80.00 - 1 unpriced"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Total P&L")).toBeInTheDocument();
  });

  it("says one position in the singular", () => {
    render(<PositionPnlTable rows={[row()]} />);

    expect(screen.getByText("1 position - cost $40.00")).toBeInTheDocument();
  });

  it("explains the empty state instead of showing a zeroed table", () => {
    render(<PositionPnlTable rows={[]} />);

    expect(screen.getByText("Nothing to price yet")).toBeInTheDocument();
    expect(screen.queryByText("All positions")).not.toBeInTheDocument();
  });

  it("renders placeholder rows while the read is in flight", () => {
    render(<PositionPnlTable loading rows={[]} />);

    expect(screen.getByLabelText("Loading position P&L")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to price yet")).not.toBeInTheDocument();
  });

  it("surfaces a read failure in place of the table", () => {
    render(<PositionPnlTable error="Could not reach the indexer." rows={[]} />);

    expect(screen.getByText("P&L unavailable")).toBeInTheDocument();
    expect(screen.getByText("Could not reach the indexer.")).toBeInTheDocument();
  });

  it("prefers the error over a concurrent loading flag", () => {
    render(<PositionPnlTable error="Boom." loading rows={[row()]} />);

    expect(screen.getByText("P&L unavailable")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading position P&L")).toBeNull();
  });
});

/** The grid row a piece of first-column text sits in. */
function rowFor(text: string): HTMLElement {
  const cell = screen.getByText(text).closest("div");

  if (!cell) {
    throw new Error(`No row found for ${text}`);
  }

  return cell;
}

function row(overrides: Partial<PnlPositionRow> = {}): PnlPositionRow {
  return {
    costBasisWad: (WAD * 4000n) / 100n,
    id: "7:yes",
    marketId: "7",
    marketQuestion: "Will it pop?",
    markPriceWad: (WAD * 62n) / 100n,
    ownedTotalWad: WAD * 100n,
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "yes",
    ...overrides,
  };
}
