"use client";

import { Info, Layers, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";

import { CloneMarketBox } from "./clone-market-box";
import { DraftCard } from "./draft-card";
import { STUDIO_SHELVES, type StudioShelf, useStudio } from "./use-studio";

const SHELF_LABELS: Record<StudioShelf, string> = {
  all: "All",
  approved: "Approved",
  in_review: "In review",
  needs_fixes: "Needs fixes",
  published: "Live",
  templates: "Templates",
};

/**
 * The creator studio (ADR 0022 creator surfaces): every draft you own on one
 * board — works in progress, reviews in flight, feedback to act on, approved
 * drafts waiting to publish, live markets, and your template shelf. Clone
 * anything (yours or any market on the board) into a fresh draft.
 */
export function StudioPage() {
  const studio = useStudio();
  const [cloneBoxOpen, setCloneBoxOpen] = useState(false);

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Creator studio
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl font-black tracking-normal">
            Your drafts
          </h1>
          <div className="flex items-center gap-2.5">
            <Button
              leftIcon={<Layers size={15} />}
              onClick={() => setCloneBoxOpen((open) => !open)}
              size="sm"
              variant="secondary"
            >
              Start from a market
            </Button>
            <Button href="/create" leftIcon={<Plus size={15} />} size="sm">
              New draft
            </Button>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          Drafts are free and private. Iterate until the reviewer approves, then publish
          when you&apos;re ready.
        </p>
      </div>

      {cloneBoxOpen ? (
        <div className="mb-6">
          <CloneMarketBox
            onClone={studio.cloneFromMarket}
            onClosed={() => setCloneBoxOpen(false)}
          />
        </div>
      ) : null}

      {studio.error ? (
        <div
          className="mb-5 flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--surface-raised)] p-4"
          role="alert"
        >
          <Info className="mt-0.5 shrink-0 text-[var(--no)]" size={16} />
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {studio.error}
          </p>
        </div>
      ) : null}

      {!studio.canPersist ? (
        <EmptyState
          body="Connect a wallet and your drafts, templates, and live markets appear here."
          title="Connect to open your studio"
        />
      ) : (
        <>
          <div className="mb-5 max-w-xl">
            <SegmentedControl
              onChange={(value) => studio.setShelf(value as StudioShelf)}
              options={STUDIO_SHELVES.map((shelf) => ({
                label: SHELF_LABELS[shelf],
                value: shelf,
              }))}
              size="sm"
              value={studio.shelf}
            />
          </div>

          {studio.isLoading ? (
            <p className="font-mono text-[12px] text-[var(--text-muted)]">
              Loading your drafts…
            </p>
          ) : studio.visibleDrafts.length === 0 ? (
            <EmptyState
              body={
                studio.shelf === "templates"
                  ? "Save any draft as a template and it lands on this shelf, ready to clone."
                  : studio.drafts.length === 0
                    ? "Start a draft and it autosaves here while you iterate."
                    : "Nothing on this shelf right now."
              }
              title={
                studio.shelf === "templates"
                  ? "No templates yet"
                  : studio.drafts.length === 0
                    ? "No drafts yet"
                    : "Shelf is empty"
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {studio.visibleDrafts.map((draft) => (
                <DraftCard
                  busy={studio.busyDraftId === draft.id}
                  draft={draft}
                  key={draft.id}
                  onClone={() => void studio.cloneDraft(draft.id)}
                  onDelete={() => void studio.removeDraft(draft.id)}
                  onToggleTemplate={() => void studio.toggleTemplate(draft)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] bg-[var(--surface-card)] px-6 py-14 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">{body}</p>
    </div>
  );
}
