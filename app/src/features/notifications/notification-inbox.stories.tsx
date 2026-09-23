import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import {
  claimablePayout,
  disputeOnHeldMarket,
  graduatedHolding,
  inboxBacklog,
  NOW,
} from "./fixtures";
import { NotificationInbox } from "./notification-inbox";
import type { MarketStatusNotification } from "./notification-types";

/** Frames the panel where the bell drops it: a fixed-width sheet on the page. */
const PanelFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", padding: 32 }}>
    <Story />
  </div>
);

/**
 * The two mark-read callbacks, spread into every story that offers them. They
 * are deliberately not meta-level args: `WithoutMarkReadActions` exists to show
 * the panel with neither wired, which a default would quietly undo.
 */
const markReadActions = {
  onMarkAllRead: () => undefined,
  onMarkRead: () => undefined,
};

const meta = {
  args: { now: NOW },
  component: NotificationInbox,
  decorators: [PanelFrame],
  parameters: { layout: "fullscreen" },
  title: "Notifications/Inbox",
} satisfies Meta<typeof NotificationInbox>;

export default meta;

type Story = StoryObj<typeof meta>;

const asRead = (notification: MarketStatusNotification): MarketStatusNotification => ({
  ...notification,
  read: true,
});

/**
 * The realistic case: a few unread at the top, older read entries below. This
 * is what a viewer who was away for a day comes back to — and the reason the
 * inbox exists at all, since every toast for these expired unseen.
 */
export const Backlog: Story = {
  args: {
    ...markReadActions,
    notifications: inboxBacklog,
  },
};

/** Everything unread: the raised rows make "what is new" a block, not a hunt. */
export const AllUnread: Story = {
  args: {
    ...markReadActions,
    notifications: inboxBacklog.map((entry) => ({ ...entry, read: false })),
  },
};

/**
 * Everything read. The unread count and "Mark all read" both disappear rather
 * than rendering a zero, so a caught-up inbox has nothing to act on.
 */
export const AllRead: Story = {
  args: {
    ...markReadActions,
    notifications: inboxBacklog.map(asRead),
  },
};

/** Three unread, mid-way through marking them off one at a time. */
export const PartiallyMarkedRead: Story = {
  args: {
    ...markReadActions,
    notifications: [
      graduatedHolding,
      claimablePayout,
      asRead(disputeOnHeldMarket),
      ...inboxBacklog.slice(4).map(asRead),
    ],
  },
};

/** A first-run account, or one that has genuinely caught up on everything. */
export const Empty: Story = {
  args: {
    ...markReadActions,
    notifications: [],
  },
};

/** The empty state with a caller-supplied second line. */
export const EmptyWithHint: Story = {
  args: {
    ...markReadActions,
    emptyHint: "Place a receipt or open a market and its status changes land here.",
    notifications: [],
  },
};

/**
 * Long enough to overflow: the list scrolls inside the panel while the header
 * and its "Mark all read" stay put, so the way out of a backlog never scrolls
 * away from the viewer.
 */
export const OverflowingListScrolls: Story = {
  args: {
    ...markReadActions,
    notifications: [
      ...inboxBacklog,
      ...inboxBacklog.map((entry, index) => ({
        ...entry,
        id: `${entry.id}-repeat-${index}`,
        read: true,
      })),
    ],
  },
};

/**
 * Read-only, with neither callback wired: no per-row control and no "Mark all
 * read", so a caller that cannot service the mutation does not offer it.
 */
export const WithoutMarkReadActions: Story = {
  args: { notifications: inboxBacklog },
};
