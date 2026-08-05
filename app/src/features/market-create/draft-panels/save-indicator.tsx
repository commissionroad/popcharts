"use client";

import { Check, CloudOff, CloudUpload } from "lucide-react";

/**
 * The quiet autosave chip above the form: saving, saved (with the draft id
 * so the studio card is recognizable), or a nudge to connect. Deliberately
 * text-muted — the flow should feel automatic, not chatty.
 */
export function SaveIndicator({
  canPersist,
  draftId,
  isSaving,
  savedAt,
}: {
  canPersist: boolean;
  draftId: string | null;
  isSaving: boolean;
  savedAt: string | null;
}) {
  if (!canPersist) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
        <CloudOff size={13} />
        Connect a wallet to save drafts
      </span>
    );
  }

  if (isSaving) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
        <CloudUpload className="animate-pulse" size={13} />
        Saving…
      </span>
    );
  }

  if (savedAt && draftId !== null) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
        <Check color="var(--yes)" size={13} />
        Saved · draft #{draftId}
      </span>
    );
  }

  return (
    <span className="font-mono text-[11px] text-[var(--text-muted)]">
      Drafts autosave as you type
    </span>
  );
}
