"use client";

import { ShieldCheck, SlidersHorizontal } from "lucide-react";

import { Field } from "@/components/ui/field";
import {
  applyGraduationTime,
  applyResolutionTime,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import { formatB, formatUsdWhole } from "@/lib/format";

import { BImpactPreview } from "./b-impact-preview";
import { CategoryPicker, DeadlineControl } from "./create-market-fields";
import {
  LivePreviewPanel,
  ReviewPanel,
  SubmittedPanel,
  SuccessPanel,
} from "./create-market-panels";
import { useCreateMarketFormState } from "./use-create-market-form-state";

/**
 * Full market creation flow: draft editing with live validation, review,
 * optional AI-review submission, and creation (mock, server-signed, or
 * wallet-signed depending on the configured creation mode). `initialNow`
 * seeds the draft deadlines so server and client render the same times.
 * State and submission flows live in useCreateMarketFormState; this
 * component is presentation.
 */
export function CreateMarketForm({ initialNow }: { initialNow: string }) {
  const {
    advanced,
    createAction,
    createdMarket,
    creationFeeLabel,
    draft,
    hasErrors,
    isCreating,
    isSubmittingForReview,
    preview,
    reviewErrorCount,
    stage,
    submitError,
    submittedReview,
    trustedCreatorCanBypassAiResolution,
    visibleErrors,
    applyGraduationPreset,
    applyResolutionPreset,
    handleCreate,
    handleReview,
    handleSubmitForReview,
    resetForm,
    returnToEdit,
    toggleAdvanced,
    updateDraft,
    updateDraftWith,
  } = useCreateMarketFormState(initialNow);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-7">
        <Field
          error={visibleErrors.question}
          hint="Phrase it so it resolves to a clear YES or NO."
          id="question"
          label="Market question"
          onChange={(event) => updateDraft("question", event.target.value)}
          placeholder="Will X happen by Y?"
          value={draft.question}
        />

        <CategoryPicker
          category={draft.category}
          error={visibleErrors.category}
          onChange={(category) => updateDraft("category", category)}
        />

        <Field
          id="description"
          label="Description"
          multiline
          onChange={(event) => updateDraft("description", event.target.value)}
          placeholder="Helpful context and source notes."
          value={draft.description}
        />

        <Field
          error={visibleErrors.resolutionCriteria}
          hint="This text should stand on its own even if a source link changes."
          id="resolution-criteria"
          label="Resolution criteria"
          multiline
          onChange={(event) => updateDraft("resolutionCriteria", event.target.value)}
          placeholder="Resolves YES if..."
          value={draft.resolutionCriteria}
        />

        <Field
          error={visibleErrors.resolutionSources}
          hint="Optional public sources. Use names or URLs, one per line or comma-separated."
          id="resolution-sources"
          label="Resolution sources"
          multiline
          onChange={(event) => updateDraft("resolutionSources", event.target.value)}
          placeholder={"CNN\nFox News\nNPR\nNYT\nBBC"}
          value={draft.resolutionSources}
        />

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
              Opening probability
            </span>
            <span className="font-mono text-[13px] text-[var(--text-muted)]">
              YES {draft.openingProbability}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-display w-14 text-[22px] font-black text-[var(--yes)]">
              {draft.openingProbability}%
            </span>
            <input
              aria-describedby="opening-probability-hint"
              aria-label="Opening YES probability"
              className="flex-1 accent-[var(--accent)]"
              id="opening-probability"
              max="98"
              min="2"
              onChange={(event) =>
                updateDraft("openingProbability", Number(event.target.value))
              }
              type="range"
              value={draft.openingProbability}
            />
            <span className="font-display w-14 text-right text-[22px] font-black text-[var(--no)]">
              {100 - draft.openingProbability}%
            </span>
          </div>
          <p
            className="mt-2 text-xs leading-5 text-[var(--text-muted)]"
            id="opening-probability-hint"
          >
            Sets the opening YES probability.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DeadlineControl
            error={visibleErrors.graduationTime}
            id="graduation-time"
            label="Graduation deadline"
            onChange={(value) =>
              updateDraftWith((current) => applyGraduationTime(current, value))
            }
            onPreset={applyGraduationPreset}
            presets={GRADUATION_PRESETS}
            selectedPreset={draft.graduationPreset}
            value={draft.graduationTime}
          />
          <DeadlineControl
            error={visibleErrors.resolutionTime}
            id="resolution-time"
            label="Resolution deadline"
            onChange={(value) =>
              updateDraftWith((current) => applyResolutionTime(current, value))
            }
            onPreset={applyResolutionPreset}
            presets={RESOLUTION_PRESETS}
            selectedPreset={draft.resolutionPreset}
            value={draft.resolutionTime}
          />
        </div>

        <div className="border-t border-[var(--border-soft)] pt-5">
          <button
            className="focus-ring flex items-center gap-2 text-[var(--text-secondary)]"
            onClick={toggleAdvanced}
            type="button"
          >
            <SlidersHorizontal size={15} color="var(--pc-cyan)" />
            <span className="font-mono text-xs font-bold tracking-[0.1em] uppercase">
              Advanced
            </span>
          </button>
          {advanced ? (
            <div className="mt-5 flex flex-col gap-5">
              <div>
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
                    Liquidity parameter b
                  </span>
                  <span className="font-mono text-[15px] text-[var(--pc-cyan)]">
                    {formatB(draft.liquidityParameter)}
                  </span>
                </div>
                <input
                  aria-label="Virtual LMSR liquidity parameter b"
                  className="w-full accent-[var(--pc-cyan)]"
                  max="10000"
                  min="500"
                  onChange={(event) =>
                    updateDraft("liquidityParameter", Number(event.target.value))
                  }
                  step="500"
                  type="range"
                  value={draft.liquidityParameter}
                />
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  Larger b is smoother and raises the graduation target. Smaller b gets
                  there faster, but price moves more sharply on early receipts.
                </p>
              </div>

              <BImpactPreview
                b={draft.liquidityParameter}
                openingProbability={draft.openingProbability}
              />

              {trustedCreatorCanBypassAiResolution ? (
                <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-raised)] p-4">
                  <input
                    checked={draft.bypassAiResolution}
                    className="mt-1 size-4 accent-[var(--pc-cyan)]"
                    onChange={(event) =>
                      updateDraft("bypassAiResolution", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
                      <ShieldCheck size={14} color="var(--pc-cyan)" />
                      AI resolution bypass
                    </span>
                    <span className="text-xs leading-5 text-[var(--text-muted)]">
                      Trusted creator market resolves outside the AI-assisted flow.
                    </span>
                  </span>
                </label>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="collateral-token"
                  label="Collateral token"
                  mono
                  readOnly
                  value="pUSD"
                />
                <Field
                  hint="Derived as 0.5 x b matched market cap."
                  id="graduation-target"
                  label="Graduation target"
                  mono
                  readOnly
                  value={`${formatUsdWhole(preview.graduationThreshold)} matched`}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        {stage === "success" && createdMarket ? (
          <SuccessPanel result={createdMarket} onReset={resetForm} />
        ) : stage === "submitted" && submittedReview ? (
          <SubmittedPanel
            createAction={createAction}
            isCreating={isCreating}
            onCreate={handleCreate}
            onEdit={returnToEdit}
            result={submittedReview}
            submitError={submitError}
          />
        ) : stage === "review" ? (
          <ReviewPanel
            createAction={createAction}
            creationFeeLabel={creationFeeLabel}
            hasErrors={hasErrors}
            isCreating={isCreating}
            isSubmittingForReview={isSubmittingForReview}
            onCreate={handleCreate}
            onEdit={returnToEdit}
            onSubmitForReview={handleSubmitForReview}
            preview={preview}
            submitError={submitError}
          />
        ) : (
          <LivePreviewPanel
            draft={draft}
            onReview={handleReview}
            preview={preview}
            reviewErrorCount={reviewErrorCount}
          />
        )}
      </aside>
    </div>
  );
}
