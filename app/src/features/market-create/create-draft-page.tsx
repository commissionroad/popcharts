"use client";

import { Info } from "lucide-react";

import { marketCreationMode } from "@/integrations/contracts/config";

import { CreateDraftForm } from "./create-draft-form";
import { ApprovedPanel } from "./draft-panels/approved-panel";
import { DraftPreviewPanel } from "./draft-panels/draft-preview-panel";
import { FeedbackPanel, ReviewScorePanel } from "./draft-panels/feedback-panel";
import { PublishedPanel } from "./draft-panels/published-panel";
import { ReviewCreditPanel } from "./draft-panels/review-credit-panel";
import { ReviewProgressPanel } from "./draft-panels/review-progress-panel";
import { SaveIndicator } from "./draft-panels/save-indicator";
import { useCreateDraftFlow } from "./use-create-draft-flow";

/**
 * The review-first launchpad (ADR 0022): drafts autosave while you type, an
 * AI reviewer gates publishing, and feedback lands inline next to the fields
 * it concerns. `initialDraftId` (from ?draft=) opens an existing draft from
 * the studio; `initialNow` keeps server and client deadline rendering equal.
 */
export function CreateDraftPage({
  initialDraftId = null,
  initialNow,
}: {
  initialDraftId?: number | null;
  initialNow: string;
}) {
  const flow = useCreateDraftFlow({ initialDraftId, initialNow });
  const creationFeeLabel =
    marketCreationMode === "devchain" ? "1 native USDC" : "Waived in preview";

  return (
    <div>
      <div className="mb-7">
        <p className="mb-2 font-mono text-[11px] tracking-[0.2em] text-[var(--accent)] uppercase">
          Launchpad
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-4xl font-black tracking-normal">
            Bake a market
          </h1>
          <SaveIndicator
            canPersist={flow.canPersist}
            draftId={flow.serverDraft?.id ?? null}
            isSaving={flow.isSaving}
            savedAt={flow.savedAt}
          />
        </div>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[var(--text-secondary)]">
          Draft it, get instant AI feedback, publish when it&apos;s approved. No fee
          until your market goes live.
        </p>
      </div>

      {flow.flowError ? (
        <div
          className="mb-5 flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--surface-raised)] p-4"
          role="alert"
        >
          <Info className="mt-0.5 shrink-0 text-[var(--no)]" size={16} />
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {flow.flowError}
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <CreateDraftForm flow={flow} />

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          {renderStagePanel(flow, creationFeeLabel)}
        </aside>
      </div>
    </div>
  );
}

function renderStagePanel(
  flow: ReturnType<typeof useCreateDraftFlow>,
  creationFeeLabel: string
) {
  const latestReview = flow.latestReview;
  const serverDraft = flow.serverDraft;

  // A meter refusal takes the aside over: buy review credit, resubmit in one
  // click. It can only arise from a submittable stage, so it never shadows
  // the in-review or published panels.
  if (flow.bondShortfall) {
    return (
      <ReviewCreditPanel
        beneficiary={
          (serverDraft?.intendedCreatorAddress ?? null) as `0x${string}` | null
        }
        fetchCredit={flow.fetchCredit}
        onDismiss={flow.clearBondShortfall}
        onFunded={() => void flow.submitForReview()}
        shortfall={flow.bondShortfall}
      />
    );
  }

  if (flow.stage === "published" && serverDraft) {
    return (
      <PublishedPanel
        draft={serverDraft}
        onSaveTemplate={() => void flow.saveAsTemplate()}
        onStartFresh={flow.startFresh}
        templateSaved={flow.templateSaved}
      />
    );
  }

  if (flow.stage === "in_review" && serverDraft) {
    return <ReviewProgressPanel question={serverDraft.question} />;
  }

  if (flow.stage === "approved" && serverDraft) {
    return (
      <>
        <ApprovedPanel
          creationFeeLabel={creationFeeLabel}
          draft={serverDraft}
          graduationThreshold={flow.preview.graduationThreshold}
          isPublishing={flow.isPublishing}
          onPublish={() => void flow.publish()}
          walletAction={flow.walletAction}
        />
        {/* Approved is not the same as strong. The scores stay reachable so a
            creator can see a weak dimension and choose to keep polishing
            instead of publishing on the strength of a green check. */}
        {latestReview ? <ReviewScorePanel review={latestReview} /> : null}
      </>
    );
  }

  if (flow.stage === "feedback" && latestReview && serverDraft) {
    return (
      <FeedbackPanel
        isResubmitting={flow.isSubmitting}
        onEdit={flow.returnToEditing}
        onResubmit={() => void flow.submitForReview()}
        review={latestReview}
        verdict={
          serverDraft.status === "rejected" || latestReview.verdict === "reject"
            ? "rejected"
            : "changes_requested"
        }
      />
    );
  }

  return (
    <>
      <DraftPreviewPanel
        canPersist={flow.canPersist}
        draft={flow.formDraft}
        errorCount={flow.errorCount}
        isSubmitting={flow.isSubmitting}
        onSubmit={() => void flow.submitForReview()}
        preview={flow.preview}
      />
      {/* Editing after an approval lands here. The last scores are the only
          guide to what still needs work, so they stay — flagged stale once the
          form no longer hashes to what was reviewed. */}
      {latestReview ? (
        <ReviewScorePanel
          review={latestReview}
          stale={latestReview.metadataHash !== flow.preview.metadataHash}
        />
      ) : null}
    </>
  );
}
