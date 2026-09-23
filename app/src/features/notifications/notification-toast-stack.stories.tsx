import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import {
  claimablePayout,
  disputeOnHeldMarket,
  graduatedHolding,
  graduatingWatched,
  NOW,
  simultaneousArrivals,
  unknownPriorStatus,
} from "./fixtures";
import { NotificationToastStack } from "./notification-toast-stack";

/**
 * Frames the column where the app shell puts it — pinned to a corner over the
 * page background — at the width it actually gets.
 */
const ToastFrame: Decorator = (Story) => (
  <div
    style={{
      background: "var(--color-page-bg)",
      display: "flex",
      justifyContent: "flex-end",
      minHeight: 520,
      padding: 32,
    }}
  >
    <Story />
  </div>
);

const meta = {
  args: {
    now: NOW,
    onDismiss: () => undefined,
    onShowAll: () => undefined,
  },
  component: NotificationToastStack,
  decorators: [ToastFrame],
  parameters: { layout: "fullscreen" },
  title: "Notifications/Toast stack",
} satisfies Meta<typeof NotificationToastStack>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One status change arriving live on a market the viewer holds receipts in. */
export const SingleArrival: Story = {
  args: { notifications: [graduatedHolding] },
};

/**
 * The same *kind* of event on a market the viewer only ever opened. Muted
 * tone, no detail line, and the only one of the two that expires on its own —
 * the whole reason `relationship` exists.
 */
export const WatchedMarketOnly: Story = {
  args: { notifications: [graduatingWatched] },
};

/**
 * Held and watched together, so the difference in weight is legible in one
 * glance rather than by flipping between stories. The held one sorts above.
 */
export const HoldingVersusWatching: Story = {
  args: { notifications: [graduatedHolding, graduatingWatched] },
};

/**
 * Resolved with money waiting — the case that must be hardest to miss. It
 * takes the accent border, carries the claim action, and has no dismiss rail
 * because nothing about it expires on a timer.
 */
export const ClaimablePayout: Story = {
  args: { notifications: [claimablePayout] },
};

/**
 * A dispute reopening an outcome the viewer is exposed to. Also waits for the
 * viewer, in danger tone rather than accent: there is nothing to claim yet,
 * but a settled-looking result just stopped being settled.
 */
export const DisputeOnHeldMarket: Story = {
  args: { notifications: [disputeOnHeldMarket] },
};

/** Three at once — the column's full height before anything is summarised. */
export const SeveralAtOnce: Story = {
  args: {
    notifications: [graduatedHolding, disputeOnHeldMarket, graduatingWatched],
  },
};

/**
 * Five arrive in the same tick. Three show and the rest become one line, and
 * the ranking is what makes that safe: the payout and the dispute are on
 * screen, the watched-market chatter is what got summarised.
 */
export const StackedOverflow: Story = {
  args: { notifications: simultaneousArrivals },
};

/**
 * A signal replayed after a reconnect, where the prior status was never seen.
 * One pill instead of a transition, rather than a guessed "from".
 */
export const UnknownPriorStatus: Story = {
  args: { notifications: [unknownPriorStatus] },
};

/**
 * Reduced motion, forced so it is inspectable without changing an OS setting;
 * in the app the viewer's `prefers-reduced-motion` drives the same flag.
 *
 * Two things change. The entrance animation is dropped rather than shortened,
 * and the dismiss countdown becomes a static rail — the app-wide reduced-motion
 * reset in `globals.css` clamps animations to 1ms, which would otherwise empty
 * the countdown instantly and read as "already expired". Nothing depends on
 * either: the close button dismisses a toast at any motion setting.
 */
export const ReducedMotion: Story = {
  args: {
    notifications: [graduatedHolding, claimablePayout, graduatingWatched],
    reducedMotion: true,
  },
};

/** Nothing arriving renders nothing at all — an empty canvas is correct here. */
export const EmptyRendersNothing: Story = {
  args: { notifications: [] },
};
