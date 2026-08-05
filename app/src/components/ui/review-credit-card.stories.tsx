import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { ReviewCreditCard } from "./review-credit-card";

/**
 * Frames the card at the two widths it has to survive: the create page's
 * aside (420px) and a third of the portfolio's metric row (~380px). They are
 * close enough that one frame stands in for both.
 */
const CardFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <div style={{ maxWidth: 400 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  component: ReviewCreditCard,
  decorators: [CardFrame],
  parameters: { layout: "fullscreen" },
  title: "UI/Review credit card",
} satisfies Meta<typeof ReviewCreditCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The rate every story prices against: $0.10 per review, as deployed. */
const RATE_WAD = "100000000000000000";

/** Comfortable balance — the card reports and gets out of the way. */
export const Funded: Story = {
  args: {
    credit: {
      availableWad: "10700000000000000000",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 107,
      runsUsed: 6,
    },
  },
};

/** At the low-water mark: still submittable, but worth acting on. */
export const LowCredit: Story = {
  args: {
    credit: {
      availableWad: "300000000000000000",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 3,
      runsUsed: 104,
    },
  },
};

/** The singular case, one submission from empty. */
export const OneReviewLeft: Story = {
  args: {
    credit: {
      availableWad: "100000000000000000",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 1,
      runsUsed: 106,
    },
  },
};

/**
 * Empty. This is the state the card exists for: today it only becomes visible
 * *after* a submission is refused, which is one submission too late.
 */
export const Empty: Story = {
  args: {
    credit: {
      availableWad: "0",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 0,
      runsUsed: 107,
    },
  },
};

/** A fresh creator who has never deposited — same empty state, no runs used. */
export const NeverDeposited: Story = {
  args: {
    credit: {
      availableWad: "0",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 0,
      runsUsed: 0,
    },
  },
};

/** With the optional action, for callers that can service a deposit. */
export const WithTopUp: Story = {
  args: {
    credit: {
      availableWad: "0",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 0,
      runsUsed: 107,
    },
    onTopUp: () => undefined,
  },
};

/** Funded, with the action offered — the proactive top-up path. */
export const FundedWithTopUp: Story = {
  args: {
    credit: {
      availableWad: "10700000000000000000",
      metered: true,
      rateWad: RATE_WAD,
      runsRemaining: 107,
      runsUsed: 6,
    },
    onTopUp: () => undefined,
  },
};

/**
 * A stack with no vault configured: submission is ungated, so the card renders
 * nothing at all. An empty canvas here is the correct result, not a broken
 * story.
 */
export const UngatedRendersNothing: Story = {
  args: {
    credit: {
      availableWad: "0",
      metered: false,
      rateWad: "0",
      runsRemaining: 0,
      runsUsed: 0,
    },
  },
};

/** Credit not read yet (no wallet connected) — also renders nothing. */
export const UnknownRendersNothing: Story = {
  args: { credit: null },
};
