import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/cn";

import { formatRelativeTime } from "../creator-studio/draft-card";
import {
  type MarketStatusNotification,
  notificationHeadline,
  notificationPriority,
  PRIORITY_COLOR,
} from "./notification-types";

/**
 * The body of one notification, shared verbatim by the toast and the inbox so
 * a viewer who missed the toast reads exactly the same words later.
 *
 * The transition renders as two {@link StatusPill}s rather than prose: the
 * board, the market header and this row then say "graduated" in one visual
 * vocabulary, which is the point of reusing the pill instead of inventing a
 * second set of status words here.
 */
export function NotificationItem({
  className,
  notification,
  now,
}: {
  className?: string | undefined;
  notification: MarketStatusNotification;
  /** Fixed clock, so stories and tests render a stable relative time. */
  now?: Date | undefined;
}) {
  const priority = notificationPriority(notification);
  const tone = PRIORITY_COLOR[priority];

  return (
    <div className={cn("flex min-w-0 gap-3", className)}>
      <span
        aria-hidden="true"
        className="mt-1 w-0.5 shrink-0 self-stretch rounded-[var(--radius-pill)]"
        style={{ background: tone }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {notification.from ? (
            <>
              <StatusPill size="sm" status={notification.from} />
              <ArrowRight
                aria-hidden="true"
                className="shrink-0 text-[var(--text-muted)]"
                size={12}
              />
            </>
          ) : null}
          <StatusPill size="sm" status={notification.to} />

          {notification.read ? null : (
            <span
              className="ml-auto size-2 shrink-0 rounded-[var(--radius-pill)]"
              // The dot is the only thing marking unread, so it is announced
              // rather than hidden: a screen reader gets the same fact the
              // colour carries.
              role="status"
              style={{ background: tone }}
            >
              <span className="sr-only">Unread</span>
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div
            className="font-display text-[15px] leading-tight font-black"
            style={{ color: tone }}
          >
            {notificationHeadline(notification)}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[var(--text-primary)]">
            {notification.marketQuestion}
          </p>
          {notification.detail ? (
            <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">
              {notification.detail}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            {notification.relationship === "holding" ? "Holding" : "Watching"}
            {" · "}
            {formatRelativeTime(notification.occurredAt, now)}
          </span>

          {notification.action ? (
            <Button href={notification.action.href} size="sm" variant="primary">
              {notification.action.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
