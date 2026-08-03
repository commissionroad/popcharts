"use client";

import type { DraftFeedbackItem } from "@popcharts/api-client/models";
import { SlidersHorizontal } from "lucide-react";

import { Field } from "@/components/ui/field";
import {
  applyGraduationTime,
  applyResolutionTime,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import { cn } from "@/lib/cn";
import { formatB, formatUsdWhole } from "@/lib/format";

import { BImpactPreview } from "./b-impact-preview";
import { CategoryPicker, DeadlineControl } from "./create-market-fields";
import { FeedbackItemCard } from "./draft-panels/feedback-panel";
import type { useCreateDraftFlow } from "./use-create-draft-flow";

type DraftFlow = ReturnType<typeof useCreateDraftFlow>;

/**
 * The draft editing surface of the review-first create flow: the same field
 * set as the classic form, plus inline AI feedback rendered directly under
 * the fields it concerns, and a lock state while a review is running. All
 * state lives in useCreateDraftFlow; this component is presentation.
 */
export function CreateDraftForm({ flow }: { flow: DraftFlow }) {
  const {
    advanced,
    applyGraduationPreset,
    applyResolutionPreset,
    fieldFeedback,
    formDraft: draft,
    formLocked,
    preview,
    toggleAdvanced,
    updateDraft,
    updateDraftWith,
    visibleErrors,
  } = flow;

  return (
    <section
      className={cn(
        "flex flex-col gap-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6 transition-opacity sm:p-7",
        formLocked ? "pointer-events-none opacity-60" : null
      )}
      {...(formLocked ? { "aria-disabled": true, inert: true } : {})}
    >
      <div>
        <Field
          error={visibleErrors.question}
          hint="Phrase it so it resolves to a clear YES or NO."
          id="question"
          label="Market question"
          onChange={(event) => updateDraft("question", event.target.value)}
          placeholder="Will X happen by Y?"
          value={draft.question}
        />
        <InlineFeedback items={fieldFeedback.question} />
      </div>

      <CategoryPicker
        category={draft.category}
        error={visibleErrors.category}
        onChange={(category) => updateDraft("category", category)}
      />

      <div>
        <Field
          id="description"
          label="Description"
          multiline
          onChange={(event) => updateDraft("description", event.target.value)}
          placeholder="Helpful context and source notes."
          value={draft.description}
        />
        <InlineFeedback items={fieldFeedback.description} />
      </div>

      <div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            error={visibleErrors.outcomeYes}
            id="outcome-yes"
            label="YES label"
            onChange={(event) => updateDraft("outcomeYes", event.target.value)}
            placeholder="YES"
            value={draft.outcomeYes}
          />
          <Field
            error={visibleErrors.outcomeNo}
            id="outcome-no"
            label="NO label"
            onChange={(event) => updateDraft("outcomeNo", event.target.value)}
            placeholder="NO"
            value={draft.outcomeNo}
          />
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          Optional display names for the outcomes, like team names. Resolution still
          follows YES/NO.
        </p>
      </div>

      <div>
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
        <InlineFeedback items={fieldFeedback.resolutionCriteria} />
      </div>

      <div>
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
        <InlineFeedback items={fieldFeedback.resolutionSources} />
      </div>

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
  );
}

/** Field-anchored review feedback, rendered right under the input it fixes. */
function InlineFeedback({ items }: { items: DraftFeedbackItem[] | undefined }) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {items.map((item) => (
        <FeedbackItemCard compact item={item} key={item.title} />
      ))}
    </div>
  );
}
