import { Bell } from "lucide-react";

import { cn } from "@/lib/cn";

/** Above this the badge stops counting and starts saying "a lot". */
export const MAX_BADGE_COUNT = 9;

/**
 * The inbox's entry point in the app nav: a bell that carries the unread
 * count.
 *
 * The badge is the only always-visible piece of the whole affordance, so it is
 * what a viewer returning after a day away actually sees first — the toast
 * they missed is long gone by then.
 */
export function NotificationBell({
  className,
  onToggle,
  open = false,
  unread,
}: {
  className?: string | undefined;
  onToggle?: (() => void) | undefined;
  open?: boolean | undefined;
  unread: number;
}) {
  const label =
    unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread";

  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className={cn(
        "focus-ring relative inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] border transition-colors",
        open
          ? "border-[var(--pc-cyan)] text-[var(--pc-cyan)]"
          : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
        className
      )}
      onClick={onToggle}
      type="button"
    >
      <Bell aria-hidden="true" size={16} />

      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="tabular absolute -top-1 -right-1 inline-flex min-w-[16px] items-center justify-center rounded-[var(--radius-pill)] bg-[var(--accent)] px-1 font-mono text-[10px] leading-4 font-bold text-[var(--accent-content)]"
        >
          {unread > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : unread}
        </span>
      ) : null}
    </button>
  );
}
