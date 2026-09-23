import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import type { Market } from "@/domain/markets/types";
import { marketFactory } from "@/test/factories/markets";

import { ClosedMarketSummary } from "./closed-market-summary";

function closedMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    closesAt: "2026-08-14T00:00:00.000Z",
    graduationTargetUsd: 12_500,
    id: "31337:7",
    matchedUsd: 3_140,
    question: "Will the harbour bridge reopen before September?",
    receiptCount: 46,
    status: "refunded",
    volumeUsd: 4_820,
    ...overrides,
  });
}

/** Frames the banner in the dark main column it renders inside. */
const MainColumn: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 720 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: ClosedMarketSummary,
  decorators: [MainColumn],
  parameters: { layout: "fullscreen" },
  title: "Market detail/Closed market summary",
} satisfies Meta<typeof ClosedMarketSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The ordinary ending: the market ran to its close date without matching enough
 * volume to graduate. The shortfall is stated as both numbers — matched against
 * target — because "did not graduate" alone leaves the reader guessing whether
 * it missed by a dollar or never started.
 */
export const ClosedWithoutGraduating: Story = {
  args: { market: closedMarket() },
};

/**
 * The owner cancelled before graduation. No close date and no shortfall apply —
 * the market did not run out of time, it was withdrawn — so the explanation
 * names the cancellation instead and the target metric is context, not a
 * measure of how close it came.
 */
export const CancelledBeforeGraduation: Story = {
  args: {
    market: closedMarket({
      matchedUsd: 620,
      receiptCount: 9,
      status: "cancelled",
      volumeUsd: 940,
    }),
  },
};

/**
 * A market with no recorded graduation target — fixture-backed, or created
 * before targets were stored. The shortfall sentence drops out and the metric
 * dashes rather than claiming a $0 target the market never had.
 */
export const NoRecordedTarget: Story = {
  args: { market: closedMarket({ graduationTargetUsd: 0 }) },
};

/**
 * A post-graduation draw is *not* this surface: it shares the `cancelled`
 * status but carries a terminal resolution event, and its holders redeem
 * outcome tokens at half value through the claim-winnings panel. The banner
 * renders nothing, leaving the resolved summary to explain that ending.
 */
export const PostgradDrawRendersNothing: Story = {
  args: {
    market: closedMarket({
      resolution: {
        kind: "cancelled",
        postgradMarket: "0x00000000000000000000000000000000000000f1",
        resolvedAt: "2026-08-20T00:00:00.000Z",
      },
      status: "cancelled",
    }),
  },
};
