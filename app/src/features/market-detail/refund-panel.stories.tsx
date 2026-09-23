import type { Portfolio, PortfolioReceipt } from "@popcharts/api-client/models";
import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import type { Market } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";
import { marketFactory } from "@/test/factories/markets";

import {
  type PanelPreview,
  PanelPreviewContext,
} from "../../../.storybook/mocks/panel-hooks";
import { ClosedMarketSummary } from "./closed-market-summary";
import { RefundPanel } from "./refund-panel";

const OWNER = "0x1111111111111111111111111111111111111111";
const pct = (cents: bigint) => ((WAD * cents) / 100n).toString();
/** The 1% entry fee on a receipt cost, WAD-scaled (protocol ADR 0014 §3). */
const entryFee = (costWad: bigint) => (costWad / 100n).toString();

function closedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    closesAt: "2026-08-14T00:00:00.000Z",
    graduationTargetUsd: 12_500,
    id: "31337:7",
    matchedUsd: 3_140,
    outcomeNo: "NO",
    outcomeYes: "YES",
    question: "Will the harbour bridge reopen before September?",
    receiptCount: 46,
    status: "refunded",
    volumeUsd: 4_820,
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
    redemptions: [],
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

function withPreview(value: PanelPreview): Decorator {
  return function PreviewDecorator(Story) {
    return (
      <PanelPreviewContext.Provider value={value}>
        <Story />
      </PanelPreviewContext.Provider>
    );
  };
}

/** Frames the panel in the dark, narrow aside it renders inside. */
const DarkAside: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 24 }}>
    <div style={{ width: 340 }}>
      <Story />
    </div>
  </div>
);

/** A connected holder with one unclaimed refund on this market. */
const oneClaimable = portfolio({ receipts: [receipt()] });

const meta = {
  component: RefundPanel,
  decorators: [DarkAside],
  parameters: { layout: "fullscreen" },
  title: "Market detail/Refund panel",
} satisfies Meta<typeof RefundPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The base state: a market that closed without graduating, and a receipt whose
 * escrowed cost is waiting to be pulled. With no paid entry fee supplied the
 * panel reports one figure — the escrow — rather than implying the fee was
 * zero.
 */
export const RefundAvailable: Story = {
  args: { market: closedMarket() },
  decorators: [
    withPreview({ address: OWNER, loading: false, portfolio: oneClaimable }),
  ],
};

/**
 * The same refund with the paid entry fee known, which is what a holder
 * actually receives: the entry fee is a success fee earned only on matched
 * volume, so on every non-graduation path it comes back in full alongside
 * escrow (protocol ADR 0014 §3). Spelling the split out is the point — the fee
 * was charged at purchase and looks spent, so a refund that silently includes
 * it reads as short.
 */
export const EntryFeeIncluded: Story = {
  args: {
    entryFees: { "11": entryFee(60n * WAD) },
    market: closedMarket(),
  },
  decorators: [
    withPreview({ address: OWNER, loading: false, portfolio: oneClaimable }),
  ],
};

/**
 * Several receipts on the same dead market. Each is its own on-chain claim, so
 * each gets its own amount, its own button and its own receipt id; the header
 * carries the market-level total so the holder does not have to add the rows
 * up to learn what the ending is worth.
 */
export const MultipleReceipts: Story = {
  args: {
    entryFees: {
      "11": entryFee(60n * WAD),
      "12": entryFee(24n * WAD),
      "13": entryFee(105n * WAD),
    },
    market: closedMarket(),
  },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        receipts: [
          receipt({ receiptId: "11" }),
          receipt({
            cost: (24n * WAD).toString(),
            receiptId: "12",
            shares: (40n * WAD).toString(),
            side: "no",
          }),
          receipt({
            cost: (105n * WAD).toString(),
            receiptId: "13",
            shares: (170n * WAD).toString(),
          }),
        ],
      }),
    }),
  ],
};

/** Mid-claim: the button reads "Claiming refund…" and is out of action. */
export const ClaimInFlight: Story = {
  args: {
    entryFees: { "11": entryFee(60n * WAD) },
    market: closedMarket(),
  },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: oneClaimable,
      refundClaim: { status: "pending" },
    }),
  ],
};

/**
 * A confirmed claim before the indexer has projected the `refunded` row: the
 * button locks to "Refund claimed" so the still-`refund_claimable` receipt
 * cannot be claimed a second time while the projection catches up.
 */
export const ClaimConfirmed: Story = {
  args: {
    entryFees: { "11": entryFee(60n * WAD) },
    market: closedMarket(),
  },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: oneClaimable,
      refundClaim: { status: "success" },
    }),
  ],
};

/**
 * A failed claim. The button stays live and relabels to "Try again", so the
 * retry is the same control the holder already pressed rather than a second
 * affordance to find, and the revert message sits directly beneath it.
 */
export const ClaimFailedWithRetry: Story = {
  args: {
    entryFees: { "11": entryFee(60n * WAD) },
    market: closedMarket(),
  },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: oneClaimable,
      refundClaim: {
        error: "The refund claim was reverted by the network. Nothing was spent.",
        status: "error",
      },
    }),
  ],
};

/**
 * Every receipt already claimed. The panel does not vanish once the money has
 * landed — it flips to a settled statement of what came back, so a holder
 * returning to the page finds a record instead of a market that appears to owe
 * them nothing for no stated reason.
 */
export const AlreadyClaimed: Story = {
  args: { market: closedMarket() },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        receipts: [
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
      }),
    }),
  ],
};

/**
 * A market the owner cancelled before graduation. Same refund, different
 * reason — and the reason is the whole difference the holder cares about, so
 * the panel leads with it rather than with a generic "refund available".
 */
export const CancelledBeforeGraduation: Story = {
  args: {
    entryFees: { "11": entryFee(60n * WAD) },
    market: closedMarket({ status: "cancelled" }),
  },
  decorators: [
    withPreview({
      address: OWNER,
      loading: false,
      portfolio: portfolio({
        receipts: [receipt({ marketStatus: "cancelled" })],
      }),
    }),
  ],
};

/**
 * A connected viewer who never held a receipt here. The panel hides rather than
 * printing an empty claim card — but the page is not a dead end, because the
 * closed-market summary above it still explains the ending to anyone reading.
 * This story renders both in page order to show exactly what that viewer sees.
 */
export const NothingToClaim: Story = {
  args: { market: closedMarket() },
  decorators: [withPreview({ address: OWNER, loading: false, portfolio: portfolio() })],
  render: (args) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 560 }}>
      <ClosedMarketSummary market={args.market} />
      <RefundPanel {...args} />
    </div>
  ),
};

/**
 * A disconnected viewer. The claim surface hides entirely — there is no wallet
 * to claim into — leaving the market's own explanation to carry the page.
 */
export const Disconnected: Story = {
  args: { market: closedMarket() },
  decorators: [withPreview({ address: null, loading: false, portfolio: null })],
};
