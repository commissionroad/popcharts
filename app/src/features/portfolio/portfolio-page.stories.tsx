import type { Portfolio, PortfolioReceipt } from "@popcharts/api-client/models";
import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { WAD } from "@/domain/tokens/wad";

import {
  type PanelPreview,
  PanelPreviewContext,
} from "../../../.storybook/mocks/panel-hooks";
import { PortfolioPage } from "./portfolio-page";

const OWNER = "0x1111111111111111111111111111111111111111";
const pct = (cents: bigint) => ((WAD * cents) / 100n).toString();

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    chainId: 31337,
    openOrders: [],
    owner: OWNER,
    positions: [],
    receipts: [],
    redemptions: [],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: (60n * WAD).toString(),
      openOrderCount: 0,
      openReceiptCount: 1,
      positionCount: 0,
      totalPositionValueWad: "0",
    },
    ...overrides,
  };
}

function receipt(overrides: Partial<PortfolioReceipt> = {}): PortfolioReceipt {
  return {
    cost: (60n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    marketStatus: "bootstrap",
    placedAt: "2026-07-01T00:00:00.000Z",
    priceBandHigh: pct(62n),
    priceBandLow: pct(55n),
    receiptId: "11",
    shares: (100n * WAD).toString(),
    side: "yes",
    status: "awaiting_graduation",
    ...overrides,
  };
}

function withPreview(value: PanelPreview): Decorator {
  return function PreviewDecorator(Story) {
    return (
      <PanelPreviewContext.Provider value={value}>
        <Story />
      </PanelPreviewContext.Provider>
    );
  };
}

/** Frames the page against the app's dark background at a realistic width. */
const PageFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 960 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: PortfolioPage,
  decorators: [PageFrame],
  parameters: { layout: "fullscreen" },
  title: "Portfolio/Portfolio page",
} satisfies Meta<typeof PortfolioPage>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Every receipt lifecycle state in the receipts table, so the settlement result
 * — retained tokens plus any refund, a returned refund, and the claimable
 * pointers — renders identically to the market-detail panel.
 */
export const ReceiptLifecycle: Story = {
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        receipts: [
          receipt({ receiptId: "11", status: "awaiting_graduation" }),
          receipt({
            receiptId: "12",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (25n * WAD).toString(),
              retainedCost: (35n * WAD).toString(),
              retainedShares: (58n * WAD).toString(),
            },
            status: "settled",
          }),
          receipt({
            cost: (40n * WAD).toString(),
            receiptId: "13",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: "0",
              retainedCost: (40n * WAD).toString(),
              retainedShares: (66n * WAD).toString(),
            },
            shares: (66n * WAD).toString(),
            side: "no",
            status: "settled",
          }),
          receipt({
            receiptId: "14",
            settlement: {
              claimedAt: "2026-07-08T00:00:00.000Z",
              refund: (60n * WAD).toString(),
            },
            side: "no",
            status: "refunded",
          }),
          receipt({ receiptId: "15", status: "claimable" }),
          receipt({ receiptId: "16", status: "refund_claimable" }),
        ],
        summary: {
          claimableReceiptCount: 2,
          lockedCollateral: (60n * WAD).toString(),
          openOrderCount: 0,
          openReceiptCount: 1,
          positionCount: 0,
          totalPositionValueWad: "0",
        },
      }),
    }),
  ],
};

/**
 * The claimed-payouts history table: a redeemed resolution winner and a
 * cancelled-draw payout. A redeemed position's balance row zeroes out and
 * leaves the tables above, so this history is the only place the payout
 * stays visible.
 */
export const ClaimedPayouts: Story = {
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        redemptions: [
          {
            collateralAmount: "120000000",
            kind: "redeemed",
            logIndex: 3,
            marketId: "7",
            marketQuestion: "Will it pop?",
            outcomeAmount: (120n * WAD).toString(),
            redeemedAt: "2026-07-12T00:00:00.000Z",
            side: "yes",
            transactionHash: `0x${"dd".repeat(32)}`,
            valueWad: (120n * WAD).toString(),
          },
          {
            collateralAmount: "30000000",
            kind: "cancelled_redeemed",
            logIndex: 9,
            marketId: "9",
            marketQuestion: "Will the draw market settle?",
            noAmount: (25n * WAD).toString(),
            redeemedAt: "2026-07-13T00:00:00.000Z",
            transactionHash: `0x${"ee".repeat(32)}`,
            valueWad: (30n * WAD).toString(),
            yesAmount: (35n * WAD).toString(),
          },
        ],
        summary: {
          claimableReceiptCount: 0,
          lockedCollateral: "0",
          openOrderCount: 0,
          openReceiptCount: 0,
          positionCount: 0,
          totalPositionValueWad: "0",
        },
      }),
    }),
  ],
};

/**
 * Settled positions in the backed-positions table: a resolved winner with its
 * working Claim button, the worthless losing side, and a cancelled-draw row
 * claimable at half value — the portfolio-side claim surfaces.
 */
export const SettledPositionClaims: Story = {
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        positions: [
          {
            committedInOrders: "0",
            currentValueWad: (120n * WAD).toString(),
            heldBalance: (120n * WAD).toString(),
            marketId: "7",
            marketQuestion: "Will it pop?",
            marketStatus: "resolved",
            outcomeToken: "0x00000000000000000000000000000000000000e0",
            ownedTotal: (120n * WAD).toString(),
            poolPriceWad: WAD.toString(),
            resolution: {
              kind: "resolved",
              postgradMarket: "0x00000000000000000000000000000000000000f0",
              resolvedAt: "2026-07-10T00:00:00.000Z",
              transactionHash: `0x${"dd".repeat(32)}`,
              winningSide: "yes",
            },
            side: "yes",
          },
          {
            committedInOrders: "0",
            currentValueWad: "0",
            heldBalance: (80n * WAD).toString(),
            marketId: "7",
            marketQuestion: "Will it pop?",
            marketStatus: "resolved",
            outcomeToken: "0x00000000000000000000000000000000000000e1",
            ownedTotal: (80n * WAD).toString(),
            poolPriceWad: "0",
            resolution: {
              kind: "resolved",
              postgradMarket: "0x00000000000000000000000000000000000000f0",
              resolvedAt: "2026-07-10T00:00:00.000Z",
              transactionHash: `0x${"dd".repeat(32)}`,
              winningSide: "yes",
            },
            side: "no",
          },
          {
            committedInOrders: "0",
            currentValueWad: (30n * WAD).toString(),
            heldBalance: (60n * WAD).toString(),
            marketId: "9",
            marketQuestion: "Will the draw market settle?",
            marketStatus: "cancelled",
            outcomeToken: "0x00000000000000000000000000000000000000e2",
            ownedTotal: (60n * WAD).toString(),
            poolPriceWad: (WAD / 2n).toString(),
            resolution: {
              kind: "cancelled",
              postgradMarket: "0x00000000000000000000000000000000000000f1",
              resolvedAt: "2026-07-11T00:00:00.000Z",
              transactionHash: `0x${"ee".repeat(32)}`,
            },
            side: "yes",
          },
        ],
        summary: {
          claimableReceiptCount: 0,
          lockedCollateral: "0",
          openOrderCount: 0,
          openReceiptCount: 0,
          positionCount: 3,
          totalPositionValueWad: (150n * WAD).toString(),
        },
      }),
    }),
  ],
};
