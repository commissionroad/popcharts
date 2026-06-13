"use client";

import {
  CheckCircle2,
  Clock,
  Info,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import {
  applyGraduationTime,
  applyResolutionTime,
  buildCreateMarketPreview,
  createInitialMarketDraft,
  formatDeadline,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
  toDateTimeLocalValue,
  validateCreateMarketDraft,
} from "@/domain/market-creation/create-market";
import type {
  CreateMarketDraft,
  CreateMarketDraftField,
  CreateMarketPreview,
  CreateMarketValidationErrors,
  MockCreatedMarket,
} from "@/domain/market-creation/types";
import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";
import { cn } from "@/lib/cn";
import { formatB, formatCents, formatUsdWhole } from "@/lib/format";

import { BImpactPreview } from "./b-impact-preview";
import { createMockMarket } from "./create-market-service";

type CreateMarketStage = "edit" | "review" | "success";

const REVIEW_ERROR_FIELD_ORDER: ReadonlyArray<CreateMarketDraftField> = [
  "question",
  "category",
  "resolutionCriteria",
  "resolutionUrl",
  "openingProbability",
  "graduationTime",
  "resolutionTime",
  "liquidityParameter",
  "graduationThreshold",
];

const REVIEW_ERROR_TARGET_IDS: Partial<Record<CreateMarketDraftField, string>> = {
  graduationTime: "graduation-time",
  openingProbability: "opening-probability",
  question: "question",
  resolutionCriteria: "resolution-criteria",
  resolutionTime: "resolution-time",
  resolutionUrl: "resolution-url",
};

export function CreateMarketForm({ initialNow }: { initialNow: string }) {
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<CreateMarketDraft>(() =>
    createInitialMarketDraft(new Date(initialNow))
  );
  const [stage, setStage] = useState<CreateMarketStage>("edit");
  const [hasTriedReview, setHasTriedReview] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdMarket, setCreatedMarket] = useState<MockCreatedMarket | null>(null);

  const validationErrors = validateCreateMarketDraft(draft);
  const visibleErrors: CreateMarketValidationErrors =
    hasTriedReview || stage === "review"
      ? validationErrors
      : getLiveDeadlineErrors(validationErrors);
  const hasErrors = Object.keys(validationErrors).length > 0;
  const reviewErrorCount =
    hasTriedReview && stage === "edit" ? countErrors(validationErrors) : 0;
  const preview = buildCreateMarketPreview(draft);

  function updateDraft<K extends keyof CreateMarketDraft>(
    field: K,
    value: CreateMarketDraft[K]
  ) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setSubmitError(null);

    if (stage === "review") {
      setStage("edit");
    }
  }

  function updateDraftWith(updater: (current: CreateMarketDraft) => CreateMarketDraft) {
    setDraft(updater);
    setSubmitError(null);

    if (stage === "review") {
      setStage("edit");
    }
  }

  function applyGraduationPreset(milliseconds: number) {
    updateDraftWith((current) =>
      applyGraduationTime(
        current,
        toDateTimeLocalValue(new Date(Date.now() + milliseconds))
      )
    );
  }

  function applyResolutionPreset(milliseconds: number) {
    updateDraftWith((current) =>
      applyResolutionTime(
        current,
        toDateTimeLocalValue(new Date(Date.now() + milliseconds))
      )
    );
  }

  function handleReview() {
    const nextErrors = validateCreateMarketDraft(draft);
    setHasTriedReview(true);

    if (Object.keys(nextErrors).length > 0) {
      setStage("edit");
      focusFirstReviewError(nextErrors);
      return;
    }

    setStage("review");
  }

  async function handleCreate() {
    const nextErrors = validateCreateMarketDraft(draft);
    setHasTriedReview(true);

    if (Object.keys(nextErrors).length > 0) {
      setStage("edit");
      return;
    }

    setIsCreating(true);
    setSubmitError(null);

    try {
      const result = await createMockMarket(draft);
      setCreatedMarket(result);
      setStage("success");
    } catch {
      setSubmitError("The mock creation service could not create this market.");
    } finally {
      setIsCreating(false);
    }
  }

  function resetForm() {
    setAdvanced(false);
    setCreatedMarket(null);
    setDraft(createInitialMarketDraft());
    setHasTriedReview(false);
    setStage("edit");
    setSubmitError(null);
  }

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
          error={visibleErrors.resolutionUrl}
          hint="Optional source, oracle note, or canonical reference."
          id="resolution-url"
          label="Resolution URL"
          onChange={(event) => updateDraft("resolutionUrl", event.target.value)}
          placeholder="https://example.com/source"
          type="url"
          value={draft.resolutionUrl}
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
            value={draft.resolutionTime}
          />
        </div>

        <div className="border-t border-[var(--border-soft)] pt-5">
          <button
            className="focus-ring flex items-center gap-2 text-[var(--text-secondary)]"
            onClick={() => setAdvanced((current) => !current)}
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

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        {stage === "success" && createdMarket ? (
          <SuccessPanel result={createdMarket} onReset={resetForm} />
        ) : stage === "review" ? (
          <ReviewPanel
            hasErrors={hasErrors}
            isCreating={isCreating}
            onCreate={handleCreate}
            onEdit={() => setStage("edit")}
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

function countErrors(errors: CreateMarketValidationErrors) {
  return Object.keys(errors).length;
}

function focusFirstReviewError(errors: CreateMarketValidationErrors) {
  const targetId = REVIEW_ERROR_FIELD_ORDER.map((field) =>
    errors[field] ? REVIEW_ERROR_TARGET_IDS[field] : undefined
  ).find(Boolean);

  if (!targetId) {
    return;
  }

  window.requestAnimationFrame(() => {
    const target = document.getElementById(targetId);

    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  });
}

function getLiveDeadlineErrors(
  validationErrors: CreateMarketValidationErrors
): CreateMarketValidationErrors {
  const liveErrors: CreateMarketValidationErrors = {};

  if (validationErrors.graduationTime) {
    liveErrors.graduationTime = validationErrors.graduationTime;
  }

  if (validationErrors.resolutionTime) {
    liveErrors.resolutionTime = validationErrors.resolutionTime;
  }

  return liveErrors;
}

function CategoryPicker({
  category,
  error,
  onChange,
}: {
  category: MarketCategory;
  error?: string | undefined;
  onChange: (category: MarketCategory) => void;
}) {
  return (
    <fieldset>
      <legend className="font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
        Category
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {MARKET_CATEGORIES.map((item) => (
          <button
            aria-pressed={category === item}
            className={cn(
              "focus-ring rounded-[var(--radius-pill)] border px-3.5 py-2 font-mono text-xs transition-colors",
              category === item
                ? "border-[var(--accent)] bg-[var(--accent-wash)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            )}
            key={item}
            onClick={() => onChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      {error ? (
        <span className="mt-2 block text-xs leading-5 text-[var(--no)]" role="alert">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

function DeadlineControl({
  error,
  id,
  label,
  onChange,
  onPreset,
  presets,
  value,
}: {
  error?: string | undefined;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onPreset: (milliseconds: number) => void;
  presets: ReadonlyArray<{ label: string; milliseconds: number }>;
  value: string;
}) {
  return (
    <div>
      <Field
        error={error}
        id={id}
        label={label}
        mono
        onChange={(event) => onChange(event.target.value)}
        type="datetime-local"
        value={value}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            className="focus-ring rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--pc-cyan)]"
            key={preset.label}
            onClick={() => onPreset(preset.milliseconds)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
        <span className="rounded-[var(--radius-pill)] border border-[var(--border-soft)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-muted)]">
          Custom
        </span>
      </div>
    </div>
  );
}

function LivePreviewPanel({
  draft,
  onReview,
  preview,
  reviewErrorCount,
}: {
  draft: CreateMarketDraft;
  onReview: () => void;
  preview: CreateMarketPreview;
  reviewErrorCount: number;
}) {
  return (
    <>
      <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
          Live preview
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-[var(--radius-pill)] border border-[var(--pc-cyan)] px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--pc-cyan)] uppercase">
            {draft.category}
          </span>
          <StatusPill size="sm" status="bootstrap" />
        </div>
        <div className="font-display min-h-12 text-xl leading-tight font-bold">
          {draft.question || "Your question appears here"}
        </div>
        <div className="flex gap-2.5">
          <PreviewOutcome label="YES" price={draft.openingProbability} side="yes" />
          <PreviewOutcome label="NO" price={100 - draft.openingProbability} side="no" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-[var(--border-soft)] pt-3">
          <CompactMetric
            label="Target"
            value={formatUsdWhole(preview.graduationThreshold)}
          />
          <CompactMetric label="b" value={formatB(draft.liquidityParameter)} />
        </div>
      </div>
      <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--accent-wash)] p-4">
        <Info className="mt-0.5 shrink-0 text-[var(--accent)]" size={16} />
        <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
          Bets are receipts, not fills. They clear at graduation; unmatched amounts
          refund at exact path cost.
        </p>
      </div>
      {reviewErrorCount > 0 ? (
        <div
          className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--no-border)] bg-[var(--surface-raised)] p-4"
          role="alert"
        >
          <Info className="mt-0.5 shrink-0 text-[var(--no)]" size={16} />
          <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
            Fix {reviewErrorCount} {reviewErrorCount === 1 ? "field" : "fields"} to
            review this market.
          </p>
        </div>
      ) : null}
      <Button leftIcon={<Wand2 size={18} />} onClick={onReview} size="lg">
        Review market
      </Button>
      <span className="text-center font-mono text-[11px] text-[var(--text-muted)]">
        No seed capital required
      </span>
    </>
  );
}

function ReviewPanel({
  hasErrors,
  isCreating,
  onCreate,
  onEdit,
  preview,
  submitError,
}: {
  hasErrors: boolean;
  isCreating: boolean;
  onCreate: () => void;
  onEdit: () => void;
  preview: CreateMarketPreview;
  submitError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--pc-cyan)] bg-[var(--accent-wash)] text-[var(--pc-cyan)]">
          <Rocket size={17} />
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Review
          </div>
          <h2 className="font-display text-xl font-black">Create market</h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Question" value={preview.metadata.question} />
        <ReviewRow label="Resolution" value={preview.metadata.resolutionCriteria} />
        {preview.metadata.resolutionUrl ? (
          <ReviewRow label="URL" mono value={preview.metadata.resolutionUrl} />
        ) : null}
        <ReviewRow
          label="Opening"
          value={`YES ${formatWadPercent(preview.protocolParams.openingProbabilityWad)}`}
        />
        <ReviewRow
          label="b"
          mono
          value={formatB(wadToNumber(preview.protocolParams.liquidityParameter))}
        />
        <ReviewRow
          label="Graduation target"
          value={`${formatUsdWhole(preview.graduationThreshold)} matched market cap`}
        />
        <ReviewRow
          label="Graduation"
          value={formatDeadlineFromSeconds(preview.protocolParams.graduationTime)}
        />
        <ReviewRow
          label="Resolution"
          value={formatDeadlineFromSeconds(preview.protocolParams.resolutionTime)}
        />
        <ReviewRow label="Metadata hash" mono value={preview.metadataHash} />
      </div>

      {submitError ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--no-border)] bg-[var(--accent-wash)] px-3 py-2 text-sm text-[var(--no)]">
          {submitError}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          disabled={hasErrors || isCreating}
          leftIcon={<Rocket size={18} />}
          onClick={onCreate}
          size="lg"
        >
          {isCreating ? "Creating..." : "Create market"}
        </Button>
        <Button className="sm:w-32" onClick={onEdit} size="lg" variant="secondary">
          Edit
        </Button>
      </div>
    </div>
  );
}

function SuccessPanel({
  onReset,
  result,
}: {
  onReset: () => void;
  result: MockCreatedMarket;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--status-graduated)] bg-[var(--surface-card)] p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--status-graduated)] text-[var(--pc-ink)]">
          <CheckCircle2 size={20} />
        </span>
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-[var(--text-muted)] uppercase">
            Mock created
          </div>
          <h2 className="font-display text-xl font-black">Market draft ready</h2>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border-soft)]">
        <ReviewRow label="Market ID" mono value={result.marketId} />
        <ReviewRow label="Metadata hash" mono value={result.metadataHash} />
        <ReviewRow
          label="Target"
          value={`${formatUsdWhole(result.graduationThreshold)} matched market cap`}
        />
        <ReviewRow
          label="Graduation"
          value={formatDeadlineFromSeconds(result.protocolParams.graduationTime)}
        />
        <ReviewRow
          label="Resolution"
          value={formatDeadlineFromSeconds(result.protocolParams.resolutionTime)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1"
          leftIcon={<RotateCcw size={18} />}
          onClick={onReset}
          size="lg"
          variant="secondary"
        >
          Create another
        </Button>
        <Button className="flex-1" disabled size="lg" variant="ghost">
          View mock market
        </Button>
      </div>
    </div>
  );
}

function PreviewOutcome({
  label,
  price,
  side,
}: {
  label: string;
  price: number;
  side: "yes" | "no";
}) {
  const color = side === "yes" ? "var(--yes)" : "var(--no)";
  const border = side === "yes" ? "var(--yes-border)" : "var(--no-border)";

  return (
    <div
      className="flex-1 rounded-[var(--radius-md)] border bg-[var(--surface-raised)] p-3.5"
      style={{ borderColor: border }}
    >
      <div className="font-mono text-[11px] font-bold" style={{ color }}>
        {label}
      </div>
      <div className="font-display mt-1 text-[22px] font-black" style={{ color }}>
        {formatCents(price)}
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div className="font-mono text-[13px] text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function ReviewRow({
  label,
  mono,
  value,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1 px-3.5 py-3 sm:grid-cols-[0.45fr_1fr] sm:gap-3">
      <div className="font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 text-sm leading-5 text-[var(--text-primary)]",
          mono ? "font-mono text-[12px] break-all" : null
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatDeadlineFromSeconds(value: bigint) {
  const date = new Date(Number(value) * 1000);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Clock size={13} color="var(--text-muted)" />
      {formatDeadline(toDateTimeLocalValue(date))}
    </span>
  );
}

function formatWadPercent(value: bigint) {
  return `${Number((value * 10_000n) / 10n ** 18n) / 100}%`;
}

function wadToNumber(value: bigint) {
  return Number(value / 10n ** 18n);
}
