import { X } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

import { NotificationItem } from "./notification-item";
import {
  type MarketStatusNotification,
  notificationPriority,
  PRIORITY_COLOR,
  TOAST_DISMISS_MS,
} from "./notification-types";

/**
 * One transient notification card.
 *
 * A toast is the *live* half of the affordance and is deliberately not trusted
 * on its own: everything it says also lands in the inbox, because a toast for
 * a market that resolved while the viewer was away is a notification nobody
 * ever received. What the toast adds is immediacy for the viewer who *is*
 * watching, and — for the two priorities with no dismiss timer — a card that
 * stays put until it is acknowledged.
 */
export function NotificationToast({
  notification,
  now,
  onDismiss,
  reducedMotion,
}: {
  notification: MarketStatusNotification;
  now?: Date | undefined;
  onDismiss?: ((id: string) => void) | undefined;
  /**
   * Honours the viewer's motion preference. Resolved once by the stack rather
   * than per toast, so a burst of arrivals cannot disagree with itself.
   */
  reducedMotion: boolean;
}) {
  const priority = notificationPriority(notification);
  const dismissMs = TOAST_DISMISS_MS[priority];
  const tone = PRIORITY_COLOR[priority];

  return (
    <div
      aria-live={priority === "ambient" ? "polite" : "assertive"}
      className={cn(
        "pointer-events-auto relative w-full overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface-card)] p-4 shadow-[var(--shadow-tile)]",
        reducedMotion ? null : "pc-notification-enter"
      )}
      role="alert"
      style={
        {
          // The two waiting-on-you priorities take a tinted border so they read
          // as different objects from across the screen, not just louder ones.
          borderColor: dismissMs === null ? tone : "var(--border)",
          "--pc-notification-dismiss": dismissMs === null ? "0ms" : `${dismissMs}ms`,
        } as CSSProperties
      }
    >
      <div className="flex items-start gap-2">
        <NotificationItem className="flex-1" notification={notification} now={now} />

        {onDismiss ? (
          <button
            aria-label="Dismiss notification"
            className="focus-ring -mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            onClick={() => onDismiss(notification.id)}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>

      {dismissMs === null ? null : (
        // Decoration only — the close button, not this rail, is how a toast is
        // actually dismissed, so nothing is lost when it does not animate.
        // Under reduced motion the rail is swapped for a static one rather
        // than merely sped up: the app-wide `prefers-reduced-motion` reset in
        // globals.css clamps animations to 1ms, which would run this countdown
        // to empty instantly and read as "already expired".
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 bottom-0 h-0.5 origin-left",
            reducedMotion ? "opacity-40" : "pc-notification-timer"
          )}
          data-testid="toast-dismiss-rail"
          data-motion={reducedMotion ? "static" : "animated"}
          style={{ background: tone }}
        />
      )}
    </div>
  );
}
