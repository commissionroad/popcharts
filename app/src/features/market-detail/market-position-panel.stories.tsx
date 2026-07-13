import type {
  Portfolio,
  PortfolioPosition,
  PortfolioReceipt,
} from "@popcharts/api-client/models";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import {
  type PanelPreview,
  PanelPreviewContext,
} from "../../../.storybook/mocks/panel-hooks";
import { MarketPositionPanel } from "./market-position-panel";

const WAD = 10n ** 18n;
const OWNER = "0x1111111111111111111111111111111111111111";
const pct = (cents: bigint) => ((WAD * cents) / 100n).toString();

function graduatedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    id: "31337:7",
    outcomeNo: "NO",
    outcomeYes: "YES",
    status: "graduated",
    ...overrides,
  });
}

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    chainId: 31337,
    openOrders: [],
    owner: OWNER,
    positions: [],
    receipts: [],
    summary: {
      claimableReceiptCount: 0,
      lockedCollateral: "0",
      openOrderCount: 0,
      openReceiptCount: 0,
      positionCount: 0,
      totalPositionValueWad: "0",
    },
    ...overrides,
  };
}

function position(overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    avgCostWad: pct(55n),
    committedInOrders: (100n * WAD).toString(),
    currentValueWad: (84n * WAD).toString(),
    graduationShares: (58n * WAD).toString(),
    heldBalance: (40n * WAD).toString(),
    marketId: "7",
    marketQuestion: "Will it pop?",
    outcomeToken: "0x00000000000000000000000000000000000000e0",
    ownedTotal: (140n * WAD).toString(),
    poolId: `0x${"aa".repeat(32)}`,
    poolPriceWad: pct(60n),
    side: "yes",
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

/** A graduated holding before the venue has a price omits value and prices. */
const unpricedPosition = position({ committedInOrders: "0" });
delete unpricedPosition.avgCostWad;
delete unpricedPosition.currentValueWad;
delete unpricedPosition.poolPriceWad;

function withPreview(value: PanelPreview): Decorator {
  return function PreviewDecorator(Story) {
    return (
      <PanelPreviewContext.Provider value={value}>
        <Story />
      </PanelPreviewContext.Provider>
    );
  };
}

const meta = {
  component: MarketPositionPanel,
  title: "Market detail/Your position panel",
} satisfies Meta<typeof MarketPositionPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A two-sided graduated holding, with part of the YES side resting in orders. */
export const GraduatedPosition: Story = {
  args: { market: graduatedMarket() },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        positions: [
          position({ side: "yes" }),
          position({
            avgCostWad: pct(38n),
            committedInOrders: "0",
            currentValueWad: (10n * WAD).toString(),
            heldBalance: (25n * WAD).toString(),
            ownedTotal: (25n * WAD).toString(),
            poolPriceWad: pct(40n),
            side: "no",
          }),
        ],
      }),
    }),
  ],
};

/** A graduated holding before the venue has a price: value and prices dash out. */
export const GraduatedUnpriced: Story = {
  args: { market: graduatedMarket() },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({ positions: [unpricedPosition] }),
    }),
  ],
};

/** Pre-graduation, the panel shows this market's waiting and claimable receipts. */
export const PreGraduationReceipts: Story = {
  args: { market: graduatedMarket({ status: "bootstrap" }) },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        receipts: [
          receipt({ receiptId: "11", status: "awaiting_graduation" }),
          receipt({
            cost: (24n * WAD).toString(),
            receiptId: "12",
            shares: (40n * WAD).toString(),
            side: "no",
            status: "claimable",
          }),
        ],
      }),
    }),
  ],
};
