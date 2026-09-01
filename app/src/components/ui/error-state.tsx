import { CircleAlert, Inbox, Lock, TriangleAlert, Wallet, WifiOff } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Which neon carries the state. Restrained on purpose: the tone colours the
 * icon and the eyebrow only, never the surface — the design kit's rule is that
 * neon punctuates rather than floods.
 */
export type ErrorStateTone = "danger" | "warning" | "info" | "muted";

/**
 * How much of the page the failure took with it.
 *
 * - `page` — the whole surface is gone. Sized to stand alone in the content
 *   column.
 * - `section` — one card failed and the rest of the page is still usable.
 *   Sized to sit in the slot its content would have filled.
 * - `inline` — a strip above content that is still on screen, for a failure
 *   that degrades rather than replaces (a stale read, a failed refresh).
 */
export type ErrorStateVariant = "page" | "section" | "inline";

/** The one thing to do about it. Renders as a button, or a link when `href` is set. */
export type ErrorStateAction = {
  href?: string;
  label: string;
  onClick?: () => void;
};

const toneColors: Record<ErrorStateTone, string> = {
  danger: "var(--danger)",
  info: "var(--info)",
  muted: "var(--text-muted)",
  warning: "var(--warning)",
};

/**
 * The shared shape behind every state below: an icon and eyebrow in the tone,
 * a title that names what failed, a body that says what to do, and at most one
 * action. Reach for a named state first — they exist so that five different
 * failures do not all render as the same box with different words.
 *
 * `body` is where a caught error's message belongs, and it should arrive from
 * `presentError` (`@/lib/error-handling`) rather than from a raw thrown
 * message: that helper is what decides which errors are safe to show verbatim
 * and collapses the rest to copy you chose. Passing a raw message here bypasses
 * that decision.
 */
export function ErrorState({
  action,
  body,
  detail,
  icon,
  title,
  tone = "danger",
  variant = "section",
}: {
  action?: ErrorStateAction;
  /** What to do about it. One or two sentences, no apology. */
  body: ReactNode;
  /** Mono footnote for a correlation id, digest, or request id. */
  detail?: string;
  icon?: ReactNode;
  /** Names what failed, in the user's terms. */
  title: string;
  tone?: ErrorStateTone;
  variant?: ErrorStateVariant;
}) {
  const style = { "--state-tone": toneColors[tone] } as CSSProperties;

  // A failure is assertive: it interrupts what the user was doing and they
  // need to hear it. An empty result is not a failure, and `EmptyState`
  // overrides this to the polite role.
  const role = tone === "muted" ? "status" : "alert";

  if (variant === "inline") {
    return (
      <div
        className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
        role={role}
        style={style}
      >
        <span className="mt-0.5 shrink-0 text-[var(--state-tone)]">
          {icon ?? <TriangleAlert aria-hidden="true" size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] tracking-[0.14em] text-[var(--state-tone)] uppercase">
            {title}
          </p>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">
            {body}
          </p>
          {detail ? <StateDetail detail={detail} /> : null}
        </div>
        {action ? <StateAction action={action} size="sm" /> : null}
      </div>
    );
  }

  const isPage = variant === "page";

  return (
    <section
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)]",
        isPage ? "p-7" : "p-6"
      )}
      role={role}
      style={style}
    >
      <div className="flex items-center gap-2.5 text-[var(--state-tone)]">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <p className="font-mono text-[10px] tracking-[0.14em] uppercase">{title}</p>
      </div>

      <p
        className={cn(
          "max-w-xl text-[var(--text-secondary)]",
          isPage ? "mt-3 text-[15px] leading-6" : "mt-2.5 text-[13px] leading-5"
        )}
      >
        {body}
      </p>

      {detail ? <StateDetail detail={detail} /> : null}

      {action ? (
        <div className={isPage ? "mt-6" : "mt-4"}>
          <StateAction action={action} size={isPage ? "md" : "sm"} />
        </div>
      ) : null}
    </section>
  );
}

function StateDetail({ detail }: { detail: string }) {
  return (
    <p className="mt-3 font-mono text-[11px] break-all text-[var(--text-muted)]">
      {detail}
    </p>
  );
}

function StateAction({
  action,
  size,
}: {
  action: ErrorStateAction;
  size: "sm" | "md";
}) {
  // `exactOptionalPropertyTypes` is on, so an absent href has to be absent
  // rather than explicitly undefined — Button branches on the key itself to
  // decide between a link and a button.
  return (
    <Button
      {...(action.href ? { href: action.href } : {})}
      {...(action.onClick ? { onClick: action.onClick } : {})}
      size={size}
      variant="secondary"
    >
      {action.label}
    </Button>
  );
}

/**
 * The whole surface failed to load. Use it in place of the page's content, not
 * above it — if the page still has usable content, the failure was a section's
 * and `SectionErrorState` is the honest size for it.
 */
export function PageErrorState({
  body,
  detail,
  onRetry,
  retryLabel = "Try again",
  title,
}: {
  body: ReactNode;
  /** A digest or request id, so a report can be tied to a log line. */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  title: string;
}) {
  return (
    <ErrorState
      {...(onRetry ? { action: { label: retryLabel, onClick: onRetry } } : {})}
      body={body}
      {...(detail ? { detail } : {})}
      icon={<CircleAlert aria-hidden="true" size={18} />}
      title={title}
      tone="danger"
      variant="page"
    />
  );
}

/**
 * One card failed while the rest of the page is fine. Render it in that card's
 * slot so the page keeps its shape and the user can see exactly which part is
 * missing.
 */
export function SectionErrorState({
  body,
  onRetry,
  retryLabel = "Retry",
  title,
}: {
  body: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  title: string;
}) {
  return (
    <ErrorState
      {...(onRetry ? { action: { label: retryLabel, onClick: onRetry } } : {})}
      body={body}
      icon={<TriangleAlert aria-hidden="true" size={16} />}
      title={title}
      tone="danger"
      variant="section"
    />
  );
}

/**
 * A successful read that found nothing. Not an error, and styled so it cannot
 * be mistaken for one: muted rather than red, dashed rather than solid, and
 * announced politely instead of interrupting. It shares the slot errors use,
 * which is exactly why the two have to look different.
 */
export function EmptyState({
  action,
  body,
  icon,
  title,
}: {
  action?: ErrorStateAction;
  body: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section
      className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface-card)] px-6 py-14 text-center"
      role="status"
    >
      <span className="text-[var(--text-muted)]">
        {icon ?? <Inbox aria-hidden="true" size={20} />}
      </span>
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">{body}</p>
      {action ? (
        <div className="mt-2">
          <StateAction action={action} size="sm" />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The browser is offline, or the API answered with nothing. Distinct from a
 * server error because the fix is the user's and the data is not lost — say
 * both, because a read failure on a portfolio page reads as a lost position
 * unless the copy rules it out.
 */
export function OfflineState({
  body = "Nothing was lost — receipts and positions live on chain, and this page only failed to read them. Check your connection and try again.",
  onRetry,
  title = "Can't reach the market API",
  variant = "section",
}: {
  body?: ReactNode;
  onRetry?: () => void;
  title?: string;
  variant?: ErrorStateVariant;
}) {
  return (
    <ErrorState
      {...(onRetry ? { action: { label: "Try again", onClick: onRetry } } : {})}
      body={body}
      icon={<WifiOff aria-hidden="true" size={variant === "page" ? 18 : 16} />}
      title={title}
      tone="warning"
      variant={variant}
    />
  );
}

/**
 * The surface needs a wallet before it has anything to show. An invitation,
 * not a failure — the user has done nothing wrong yet — so it takes the info
 * tone and leads with the action.
 */
export function WalletRequiredState({
  body = "Connect a wallet to see your receipts, backed positions, and open orders across every market.",
  onConnect,
  title = "No wallet connected",
  variant = "section",
}: {
  body?: ReactNode;
  onConnect?: () => void;
  title?: string;
  variant?: ErrorStateVariant;
}) {
  return (
    <ErrorState
      {...(onConnect
        ? { action: { label: "Connect wallet", onClick: onConnect } }
        : {})}
      body={body}
      icon={<Wallet aria-hidden="true" size={variant === "page" ? 18 : 16} />}
      title={title}
      tone="info"
      variant={variant}
    />
  );
}

/**
 * A wallet is connected and still may not do this — someone else's draft,
 * another wallet's position, a creator-only control. Name the wallet that was
 * refused: "not allowed" plus a silent account switch is the shape of this bug
 * report, and showing the address answers it before it is filed.
 */
export function PermissionDeniedState({
  action,
  body,
  title = "This wallet can't open that",
  walletAddress,
}: {
  action?: ErrorStateAction;
  body: ReactNode;
  title?: string;
  /** Shown verbatim as the mono footnote, so the user can check the account. */
  walletAddress?: string;
}) {
  return (
    <ErrorState
      {...(action ? { action } : {})}
      body={body}
      {...(walletAddress ? { detail: walletAddress } : {})}
      icon={<Lock aria-hidden="true" size={16} />}
      title={title}
      tone="danger"
      variant="section"
    />
  );
}
