import type { PortfolioReceipt } from "@popcharts/api-client/models";
import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { WAD } from "@/domain/tokens/wad";

import { closedMarketRefunds } from "./refund-breakdown";
import { RefundSummaryCard } from "./refund-summary-card";

const CHAIN_ID = 31337;
const pct = (cents: bigint) => ((WAD * cents) / 100n).toString();
/** The 1% entry fee on a receipt cost, WAD-scaled (protocol ADR 0014 §3). */
const entryFee = (costWad: bigint) => (costWad / 100n).toString();

function receipt(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will the harbour bridge reopen before September?",
    marketStatus: "refunded",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: pct(62n),
    priceBandLow: pct(55n),
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "refund_claimable",
    ...overrides,
  };
}

/** Frames the card against the app background at the portfolio's width. */
const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 720 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: RefundSummaryCard,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "Portfolio/Refund summary card",
} satisfies Meta<typeof RefundSummaryCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Two markets that ended without graduating, for opposite reasons: one ran out
 * of time short of its target, one the owner withdrew. Both refund in full, and
 * the card names each reason next to its amount — grouped by market, because
 * the receipts table below already lists these receipt-by-receipt, where four
 * refunds on one dead market read as four unexplained ones.
 */
export const RefundsToClaim: Story = {
  args: {
    refunds: closedMarketRefunds(
      [
        receipt({ receiptId: "11" }),
        receipt({
          cost: (24n * WAD).toString(),
          receiptId: "12",
          shares: (40n * WAD).toString(),
          side: "no",
        }),
        receipt({
          cost: (150n * WAD).toString(),
          marketId: "9",
          marketQuestion: "Will the ferry terminal open on schedule?",
          marketStatus: "cancelled",
          receiptId: "21",
          shares: (250n * WAD).toString(),
        }),
      ],
      CHAIN_ID,
      {
        "11": entryFee(60n * WAD),
        "12": entryFee(24n * WAD),
        "21": entryFee(150n * WAD),
      }
    ),
  },
};

/**
 * The same rows with no paid entry fee supplied. Each market reports escrow
 * alone and the "includes entry fees" line drops out entirely, rather than
 * printing a $0 fee the holder would read as the protocol having kept it.
 */
export const EntryFeeUnknown: Story = {
  args: {
    refunds: closedMarketRefunds(
      [
        receipt({ receiptId: "11" }),
        receipt({
          cost: (150n * WAD).toString(),
          marketId: "9",
          marketQuestion: "Will the ferry terminal open on schedule?",
          marketStatus: "cancelled",
          receiptId: "21",
          shares: (250n * WAD).toString(),
        }),
      ],
      CHAIN_ID
    ),
  },
};

/**
 * Everything already claimed. The header's "to claim" total disappears and each
 * row states what was returned and across how many receipts — the card becomes
 * a record of the ending rather than a call to action.
 */
export const AllClaimed: Story = {
  args: {
    refunds: closedMarketRefunds(
      [
        receipt({
          receiptId: "11",
          settlement: {
            claimedAt: "2026-08-16T00:00:00.000Z",
            refund: (60n * WAD + (60n * WAD) / 100n).toString(),
          },
          status: "refunded",
        }),
        receipt({
          cost: (24n * WAD).toString(),
          receiptId: "12",
          settlement: {
            claimedAt: "2026-08-16T00:00:00.000Z",
            refund: (24n * WAD + (24n * WAD) / 100n).toString(),
          },
          shares: (40n * WAD).toString(),
          side: "no",
          status: "refunded",
        }),
      ],
      CHAIN_ID
    ),
  },
};

/**
 * A market mid-way through: one receipt claimed, one still outstanding. The
 * headline amount counts only what is still owed, so it never overstates what a
 * click would actually return.
 */
export const PartiallyClaimed: Story = {
  args: {
    refunds: closedMarketRefunds(
      [
        receipt({
          receiptId: "11",
          settlement: {
            claimedAt: "2026-08-16T00:00:00.000Z",
            refund: (60n * WAD + (60n * WAD) / 100n).toString(),
          },
          status: "refunded",
        }),
        receipt({
          cost: (24n * WAD).toString(),
          receiptId: "12",
          shares: (40n * WAD).toString(),
          side: "no",
        }),
      ],
      CHAIN_ID,
      { "12": entryFee(24n * WAD) }
    ),
  },
};

/**
 * A portfolio with no closed markets renders nothing, so the page carries no
 * empty section for the common case where every market a holder touched is
 * still running.
 */
export const NoClosedMarkets: Story = {
  args: { refunds: [] },
};
