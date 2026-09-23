import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";

import { inboxBacklog, NOW } from "./fixtures";
import { NotificationBell } from "./notification-bell";
import { NotificationInbox } from "./notification-inbox";
import { unreadCount } from "./notification-types";

/** Frames the bell the way the app nav does: a small control on a dark bar. */
const NavFrame: Decorator = (Story) => (
  <div
    style={{
      background: "var(--color-page-bg)",
      display: "flex",
      justifyContent: "flex-end",
      padding: 32,
    }}
  >
    <Story />
  </div>
);

const meta = {
  component: NotificationBell,
  decorators: [NavFrame],
  parameters: { layout: "fullscreen" },
  title: "Notifications/Bell",
} satisfies Meta<typeof NotificationBell>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Caught up: no badge at all, rather than a badge reading zero. */
export const NoUnread: Story = {
  args: { unread: 0 },
};

/** The ordinary case — a small, countable number. */
export const Unread: Story = {
  args: { unread: 3 },
};

/** The largest count that still reads as a number. */
export const UnreadAtBadgeLimit: Story = {
  args: { unread: 9 },
};

/** Past the limit the badge stops counting, so it cannot outgrow the bell. */
export const UnreadOverflow: Story = {
  args: { unread: 42 },
};

/** Open, with the inbox showing — the bell keeps the open state visible. */
export const OpenWithInbox: Story = {
  args: { open: true, unread: unreadCount(inboxBacklog) },
  decorators: [
    (Story) => (
      <div
        style={{
          background: "var(--color-page-bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 12,
          padding: 32,
        }}
      >
        <Story />
        <NotificationInbox
          notifications={inboxBacklog}
          now={NOW}
          onMarkAllRead={() => undefined}
          onMarkRead={() => undefined}
        />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen" },
};
