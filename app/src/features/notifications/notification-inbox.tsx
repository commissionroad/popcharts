import { BellOff, Check } from "lucide-react";

import { cn } from "@/lib/cn";

import { NotificationItem } from "./notification-item";
import { type MarketStatusNotification, unreadCount } from "./notification-types";

/**
 * The durable half of the affordance: every status change that was ever
 * toasted, still here afterwards.
 *
 * This is the part that makes the surface a notification system rather than a
 * decoration. A market can graduate, be disputed, and resolve with money
 * waiting while the viewer has no tab open at all; a toast for any of those is
 * something nobody saw. The inbox is what they come back to.
 */
export function NotificationInbox({
  emptyHint,
  notifications,
  now,
  onMarkAllRead,
  onMarkRead,
}: {
  /** Optional second line under the empty state's headline. */
  emptyHint?: string | undefined;
  /** Newest first. */
  notifications: MarketStatusNotification[];
  now?: Date | undefined;
  onMarkAllRead?: (() => void) | undefined;
  onMarkRead?: ((id: string) => void) | undefined;
}) {
  const unread = unreadCount(notifications);

  return (
    <section
      aria-label="Notifications"
      className="flex w-full max-w-[420px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] shadow-[var(--shadow-tile)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3">
        <h2 className="font-mono text-[11px] tracking-[0.12em] text-[var(--text-secondary)] uppercase">
          Notifications
          {unread > 0 ? (
            <span className="ml-2 text-[var(--accent)]">{unread} unread</span>
          ) : null}
        </h2>

        {unread > 0 && onMarkAllRead ? (
          <button
            className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            onClick={onMarkAllRead}
            type="button"
          >
            <Check aria-hidden="true" size={12} />
            {/* The label's type scale lives on a span, not the button. The
                unlayered `button { font: inherit }` in globals.css outranks
                Tailwind's layered utilities, so a font-size class on a button
                is silently ignored app-wide (see the PR notes). */}
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase">
              Mark all read
            </span>
          </button>
        ) : null}
      </header>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <BellOff aria-hidden="true" className="text-[var(--text-muted)]" size={22} />
          <p className="font-display text-[15px] font-black text-[var(--text-secondary)]">
            Nothing to catch up on
          </p>
          <p className="max-w-[260px] text-[12.5px] leading-5 text-[var(--text-muted)]">
            {emptyHint ?? "Status changes on markets you hold or watch will land here."}
          </p>
        </div>
      ) : (
        <ul className="max-h-[440px] divide-y divide-[var(--border-soft)] overflow-y-auto">
          {notifications.map((notification) => (
            <li
              className={cn(
                "flex items-start gap-2 px-4 py-3.5",
                // Unread rows sit on the raised surface. It is a deliberately
                // quiet reinforcement, not the signal: the palette's card and
                // raised tokens are one step apart, so the dot and the header
                // count are what actually carry unread.
                notification.read ? null : "bg-[var(--surface-raised)]"
              )}
              key={notification.id}
            >
              <NotificationItem
                className="flex-1"
                notification={notification}
                now={now}
              />

              {/* Per-row rather than a whole-row click target: the row already
                  contains the claim action, and a button inside a button is
                  invalid markup. */}
              {notification.read || !onMarkRead ? null : (
                <button
                  aria-label={`Mark as read: ${notification.marketQuestion}`}
                  className="focus-ring inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  onClick={() => onMarkRead(notification.id)}
                  title="Mark as read"
                  type="button"
                >
                  <Check aria-hidden="true" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
