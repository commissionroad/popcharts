"use client";

import { Bell } from "lucide-react";

import { NotificationToast } from "./notification-toast";
import {
  type MarketStatusNotification,
  type NotificationPriority,
  notificationPriority,
} from "./notification-types";
import { useReducedMotion } from "./use-reduced-motion";

/** How many toasts are on screen at once before the rest become a summary. */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * Which toast survives a crowded moment. Lower wins.
 *
 * Recency alone is the wrong rule: three markets you only watched can move in
 * the same second a fourth pays you out, and the payout is the one that must
 * not be the one pushed off the bottom.
 */
const PRIORITY_RANK: Record<NotificationPriority, number> = {
  action: 0,
  alert: 1,
  update: 2,
  ambient: 3,
};

/**
 * The live toast column.
 *
 * Layout only — the caller positions it (the app shell fixes it to a corner);
 * keeping the stack unpositioned is what lets a story frame it inline. It owns
 * no timers and no subscription: arrivals, dismissal and the ADR 0021 change
 * feed all belong to whatever renders it.
 */
export function NotificationToastStack({
  maxVisible = MAX_VISIBLE_TOASTS,
  notifications,
  now,
  onDismiss,
  onShowAll,
  reducedMotion,
}: {
  maxVisible?: number | undefined;
  /** Newest first. */
  notifications: MarketStatusNotification[];
  now?: Date | undefined;
  onDismiss?: ((id: string) => void) | undefined;
  /** Opens the inbox; the overflow summary is inert without it. */
  onShowAll?: (() => void) | undefined;
  /** Forces the motion treatment. Left undefined, the viewer's setting wins. */
  reducedMotion?: boolean | undefined;
}) {
  const prefersReducedMotion = useReducedMotion();
  const motionReduced = reducedMotion ?? prefersReducedMotion;

  if (notifications.length === 0) {
    return null;
  }

  // Stable sort, so equal-priority toasts keep the caller's newest-first order.
  const ranked = [...notifications].sort(
    (left, right) =>
      PRIORITY_RANK[notificationPriority(left)] -
      PRIORITY_RANK[notificationPriority(right)]
  );
  const visible = ranked.slice(0, maxVisible);
  const overflow = ranked.length - visible.length;

  return (
    <div className="pointer-events-none flex w-full max-w-[400px] flex-col gap-2.5">
      {visible.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          now={now}
          onDismiss={onDismiss}
          reducedMotion={motionReduced}
        />
      ))}

      {overflow > 0 ? (
        <button
          className="focus-ring pointer-events-auto inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-60"
          disabled={!onShowAll}
          onClick={onShowAll}
          type="button"
        >
          <Bell aria-hidden="true" size={13} />
          {/* Type scale on the span, not the button -- see the note in
              notification-inbox.tsx. */}
          <span className="font-mono text-[11px] tracking-[0.08em] uppercase">
            {overflow} more in your inbox
          </span>
        </button>
      ) : null}
    </div>
  );
}
