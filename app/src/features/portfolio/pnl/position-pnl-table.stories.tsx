import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { WAD } from "@/domain/tokens/wad";

import { type PnlPositionRow, PositionPnlTable } from "./position-pnl-table";

/** A WAD money amount from whole cents — no float ever touches a fixture. */
const cents = (value: bigint) => (WAD * value) / 100n;

/** A WAD outcome-token amount from whole tokens. */
const tokens = (value: bigint) => WAD * value;

/** Frames the table against the app's dark background at page width. */
const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 960 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: PositionPnlTable,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "Portfolio/Position P&L",
} satisfies Meta<typeof PositionPnlTable>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 100 YES bought at 40c, marked at 62c. The gain reads three ways without
 * colour: an up arrow, a leading `+`, and the screen-reader word "Gain of".
 */
export const InProfit: Story = {
  args: { rows: [inProfit()] },
};

/** The mirror case: 100 NO at 55c marked down to 31c. */
export const AtALoss: Story = {
  args: { rows: [atALoss()] },
};

/**
 * Marked exactly at entry. Break-even is its own state, not a very small
 * gain — a dash glyph and an unsigned `$0.00`, in secondary text rather than
 * either P&L colour.
 */
export const BreakEven: Story = {
  args: { rows: [breakEven()] },
};

/**
 * A resolved winner, fully redeemed: 150 YES bought at 48c and paid out at
 * $1. Nothing is left to mark, so the whole gain is realised and the open lot
 * columns are empty.
 */
export const ResolvedWinnerRealised: Story = {
  args: { rows: [resolvedWinner()] },
};

/**
 * A resolved loser. The tokens still sit in the wallet, so they keep a row —
 * but resolution fixed their mark at 0c, and the entire cost basis is a loss.
 * Worth seeing at full width: -100.0% is the widest figure the column takes.
 */
export const ResolvedLoser: Story = {
  args: { rows: [resolvedLoser()] },
};

/**
 * Three fills at 38c, 52c and 61c. The average entry (47c) matches none of
 * them, which is exactly why the column exists — and why the fill count sits
 * beside the market, so nobody reads the average as a single trade.
 */
export const PartialFillsAtDifferentPrices: Story = {
  args: { rows: [partialFills()] },
};

/**
 * A position half sold: the closed lot's profit is realised, the rest still
 * floats. The two columns never merge, because only one of them is money the
 * wallet actually has.
 */
export const PartlySoldPosition: Story = {
  args: { rows: [partlySold()] },
};

/**
 * The pool quote is missing (uninitialized pool, or a failed venue read), so
 * the open lot has no mark, no value and no unrealised figure. The row shows
 * dashes rather than a `$0.00` that would read as a total loss.
 */
export const UnpricedPosition: Story = {
  args: { rows: [unpriced()] },
};

/**
 * Every state at once, with the rollup: subtotals sit under the columns they
 * sum, the header carries total P&L and return on capital deployed, and the
 * summary row says how many positions could not be priced — so a partial
 * total is never presented as a final one.
 */
export const PortfolioSummary: Story = {
  args: {
    rows: [
      inProfit(),
      atALoss(),
      breakEven(),
      partialFills(),
      partlySold(),
      resolvedWinner(),
      resolvedLoser(),
      unpriced(),
    ],
  },
};

/** No graduated positions yet — receipts alone produce no P&L. */
export const ZeroPositions: Story = {
  args: { rows: [] },
};

/** The read is in flight. */
export const Loading: Story = {
  args: { loading: true, rows: [] },
};

/** The read failed. */
export const ErrorState: Story = {
  args: {
    error: "Could not reach the indexer. Your positions are unaffected.",
    rows: [],
  },
};

function inProfit(): PnlPositionRow {
  return {
    costBasisWad: cents(4000n),
    id: "7:yes",
    marketId: "7",
    marketQuestion: "Will it pop before the end of the quarter?",
    markPriceWad: cents(62n),
    ownedTotalWad: tokens(100n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "yes",
  };
}

function atALoss(): PnlPositionRow {
  return {
    costBasisWad: cents(5500n),
    id: "9:no",
    marketId: "9",
    marketQuestion: "Will the index close above 5,000?",
    markPriceWad: cents(31n),
    ownedTotalWad: tokens(100n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "no",
  };
}

function breakEven(): PnlPositionRow {
  return {
    costBasisWad: cents(4000n),
    id: "12:yes",
    marketId: "12",
    marketQuestion: "Will the launch slip past September?",
    markPriceWad: cents(50n),
    ownedTotalWad: tokens(80n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "yes",
  };
}

function resolvedWinner(): PnlPositionRow {
  return {
    costBasisWad: 0n,
    id: "3:yes",
    marketId: "3",
    marketQuestion: "Did the bill pass its second reading?",
    markPriceWad: WAD,
    ownedTotalWad: 0n,
    realisedCostWad: cents(7200n),
    realisedProceedsWad: cents(15000n),
    side: "yes",
    standing: "won",
  };
}

function resolvedLoser(): PnlPositionRow {
  return {
    costBasisWad: cents(5400n),
    id: "3:no",
    marketId: "3",
    marketQuestion: "Did the bill pass its second reading?",
    markPriceWad: 0n,
    ownedTotalWad: tokens(120n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "no",
    standing: "lost",
  };
}

function partialFills(): PnlPositionRow {
  // 60 at 38c, 40 at 52c, 25 at 61c: $58.85 over 125 tokens, so the average
  // entry is 47c — a price none of the three fills was struck at.
  return {
    costBasisWad: cents(5885n),
    entryFillCount: 3,
    id: "18:yes",
    marketId: "18",
    marketQuestion: "Will the album chart in the top ten?",
    markPriceWad: cents(55n),
    ownedTotalWad: tokens(125n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "yes",
  };
}

function partlySold(): PnlPositionRow {
  // Bought 200 at an average 44c, sold 80 of them at 58c: $35.20 of cost went
  // out at $46.40, leaving 120 tokens carrying $52.80 of basis.
  return {
    costBasisWad: cents(5280n),
    entryFillCount: 4,
    id: "21:no",
    marketId: "21",
    marketQuestion: "Will the merger clear review this year?",
    markPriceWad: cents(51n),
    ownedTotalWad: tokens(120n),
    realisedCostWad: cents(3520n),
    realisedProceedsWad: cents(4640n),
    side: "no",
  };
}

function unpriced(): PnlPositionRow {
  return {
    costBasisWad: cents(3600n),
    id: "25:yes",
    marketId: "25",
    marketQuestion: "Will the venue pool be seeded this week?",
    markPriceWad: null,
    ownedTotalWad: tokens(90n),
    realisedCostWad: 0n,
    realisedProceedsWad: 0n,
    side: "yes",
  };
}
