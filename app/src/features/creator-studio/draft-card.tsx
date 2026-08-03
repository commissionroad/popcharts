"use client";

import type { MarketDraft } from "@popcharts/api-client/models";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";

/** Status → chip color + label for draft cards. */
export const DRAFT_STATUS_META: Record<
  MarketDraft["status"],
  { color: string; label: string }
> = {
  approved: { color: "var(--yes)", label: "Approved" },
  changes_requested: { color: "var(--pc-amber)", label: "Needs fixes" },
  editing: { color: "var(--pc-cyan)", label: "Draft" },
  in_review: { color: "var(--pc-violet)", label: "In review" },
  published: { color: "var(--yes)", label: "Live" },
  rejected: { color: "var(--no)", label: "Rejected" },
};

/** "3m ago" style rendering for a draft's last-touched time. */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const thenMs = Date.parse(iso);

  if (Number.isNaN(thenMs)) {
    return "";
  }

  const seconds = Math.max(0, Math.round((now.getTime() - thenMs) / 1000));

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * One draft on a studio shelf: status, question, the review's one-line
 * summary when it has one, and the quick actions (open in the editor, clone,
 * template shelf toggle, delete; live drafts link to their market).
 */
export function DraftCard({
  busy,
  draft,
  onClone,
  onDelete,
  onToggleTemplate,
}: {
  busy: boolean;
  draft: MarketDraft;
  onClone: () => void;
  onDelete: () => void;
  onToggleTemplate: () => void;
}) {
  const status = DRAFT_STATUS_META[draft.status];
  const marketAppId =
    draft.publishedChainId !== null && draft.publishedMarketId !== null
      ? `${draft.publishedChainId}:${draft.publishedMarketId}`
      : null;
  const summary = draft.latestReview?.feedback.summary ?? null;

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-5 transition-opacity",
        busy ? "opacity-60" : null
      )}
      data-testid={`draft-card-${draft.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="rounded-[var(--radius-pill)] border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase"
          style={{
            borderColor: `color-mix(in srgb, ${status.color} 50%, transparent)`,
            color: status.color,
          }}
        >
          {draft.isTemplate ? "Template" : status.label}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {formatRelativeTime(draft.updatedAt)}
        </span>
      </div>

      <Link
        className="focus-ring font-display line-clamp-2 min-h-11 text-lg leading-snug font-bold hover:text-[var(--accent)]"
        href={`/create?draft=${draft.id}`}
      >
        {draft.question.trim() || "Untitled draft"}
      </Link>

      <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
        <span className="uppercase">{draft.category}</span>
        <span aria-hidden>·</span>
        <span>#{draft.id}</span>
      </div>

      {summary ? (
        <p className="line-clamp-2 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          {summary}
        </p>
      ) : null}

      <div className="mt-auto flex items-center gap-1 border-t border-[var(--border-soft)] pt-3">
        <CardAction
          href={`/create?draft=${draft.id}`}
          icon={<Pencil size={14} />}
          label={draft.status === "published" ? "View draft" : "Open"}
        />
        {marketAppId ? (
          <CardAction
            href={`/markets/${marketAppId}`}
            icon={<ExternalLink size={14} />}
            label="Market"
          />
        ) : null}
        <CardAction
          disabled={busy}
          icon={<Copy size={14} />}
          label="Clone"
          onClick={onClone}
        />
        <CardAction
          disabled={busy}
          icon={draft.isTemplate ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          label={draft.isTemplate ? "Untemplate" : "Template"}
          onClick={onToggleTemplate}
        />
        <span className="flex-1" />
        <CardAction
          danger
          disabled={busy}
          icon={<Trash2 size={14} />}
          label="Delete"
          onClick={onDelete}
        />
      </div>
    </article>
  );
}

function CardAction({
  danger = false,
  disabled = false,
  href,
  icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  href?: string;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const className = cn(
    "focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 font-mono text-[11px] transition-colors",
    danger
      ? "text-[var(--text-muted)] hover:text-[var(--no)]"
      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
  );

  if (href) {
    return (
      <Link className={className} href={href}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <button className={className} disabled={disabled} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}
