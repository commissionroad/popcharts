import type { MarketStatus } from "@/domain/markets/types";

/**
 * How the viewer is attached to the market a notification is about.
 *
 * This is the axis that decides *weight*, not the status is. A market you hold
 * receipts or outcome tokens in can cost you money when it moves; a market
 * you merely opened once cannot. Both are worth telling you about, and telling you
 * about them the same way is what makes a notification surface unreadable.
 */
export type MarketRelationship = "holding" | "watching";

/**
 * How hard a notification should work to be seen, derived from the
 * relationship and the transition by {@link notificationPriority} rather than
 * stored — the caller supplies facts, not an urgency opinion.
 */
export type NotificationPriority = "action" | "alert" | "update" | "ambient";

/** A thing the viewer can do about the notification, when there is one. */
export type NotificationAction = {
  /** Button text. Name the money where there is money: "Claim $412.60". */
  label: string;
  href: string;
};

/**
 * One market status transition, addressed to one viewer.
 *
 * `from`/`to` are the real off-chain lifecycle statuses from
 * `server/src/db/schema/markets.ts` — the same set {@link
 * "@/components/ui/status-pill"} renders — so a notification can only ever
 * describe a transition the system can actually produce. `from` is null when
 * the prior status is unknown (a market that entered the viewer's world
 * already moving, or a replayed signal past the change-feed retention window).
 */
export type MarketStatusNotification = {
  id: string;
  chainId: number;
  marketId: string;
  marketQuestion: string;
  from: MarketStatus | null;
  to: MarketStatus;
  relationship: MarketRelationship;
  /** ISO 8601, from the change-feed row rather than client receipt time. */
  occurredAt: string;
  read: boolean;
  /** Free prose about the viewer's own stake — the presentational layer has
   * no position data to derive it from, so the caller supplies it. */
  detail?: string;
  action?: NotificationAction;
};

/**
 * The headline for an *arriving* status, one entry per {@link MarketStatus}.
 *
 * Deliberately never the status pill's own label. The row already renders the
 * transition as two pills, so a headline reading "Graduated" next to a pill
 * reading "Graduated" spends the largest text on the page saying nothing. Each
 * of these says what the transition means for the viewer instead.
 *
 * `satisfies Record<MarketStatus, string>` on purpose, following the fact
 * table in `server/src/db/schema/markets.ts`: appending a status to
 * `MARKET_STATUSES` should fail this file to compile rather than silently
 * produce a notification with no words in it.
 */
const ARRIVAL_HEADLINE = {
  bootstrap: "Open for receipts",
  cancelled: "No longer trading",
  disputed: "Outcome challenged",
  graduated: "Now trading outcome tokens",
  graduating: "Clearing now",
  refunded: "Stake returned",
  rejected: "Not accepted in review",
  resolution_pending: "Outcome proposed",
  resolved: "Outcome final",
  under_review: "Back in review",
} as const satisfies Record<MarketStatus, string>;

/** The headline sentence for a notification's arriving status. */
export function notificationHeadline(notification: MarketStatusNotification): string {
  return ARRIVAL_HEADLINE[notification.to];
}

/**
 * How loudly to render a notification.
 *
 * Ordered by what it costs the viewer to miss it, which is why an action
 * outranks everything: an unclaimed payout is the one outcome a dismissed
 * toast can actually lose you money on. A dispute is next — it is the only
 * transition that can still take a settled-looking outcome away — and only
 * when you hold something. Everything else on a market you hold is an update,
 * and everything on a market you merely watched is ambient.
 */
export function notificationPriority(
  notification: MarketStatusNotification
): NotificationPriority {
  if (notification.action) {
    return "action";
  }

  if (notification.relationship === "watching") {
    return "ambient";
  }

  return notification.to === "disputed" ? "alert" : "update";
}

/**
 * How long a toast of each priority stays up, in milliseconds; null means it
 * waits for the viewer.
 *
 * The two nulls are the whole argument for pairing toasts with an inbox: a
 * claimable payout and a dispute must not expire on a timer, and a viewer who
 * was away never saw the timer at all.
 */
export const TOAST_DISMISS_MS = {
  action: null,
  alert: null,
  ambient: 6_000,
  update: 12_000,
} as const satisfies Record<NotificationPriority, number | null>;

/** The token carrying each priority's urgency. Never a raw colour. */
export const PRIORITY_COLOR = {
  action: "var(--accent)",
  alert: "var(--danger)",
  ambient: "var(--text-muted)",
  update: "var(--pc-cyan)",
} as const satisfies Record<NotificationPriority, string>;

/** Count of the unread entries in a list, for the bell's badge. */
export function unreadCount(notifications: MarketStatusNotification[]): number {
  return notifications.filter((notification) => !notification.read).length;
}
