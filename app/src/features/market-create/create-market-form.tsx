"use client";

import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { usePublicClient, useReadContract, useWalletClient } from "wagmi";

import { Field } from "@/components/ui/field";
import {
  applyGraduationTime,
  applyResolutionTime,
  buildCreateMarketPreview,
  createInitialMarketDraft,
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
  toDateTimeLocalValue,
  validateCreateMarketDraft,
} from "@/domain/market-creation/create-market";
import type {
  CreatedMarket,
  CreateMarketDraft,
  CreateMarketValidationErrors,
} from "@/domain/market-creation/types";
import {
  getPopChartsContractConfig,
  marketCreationMode,
  marketCreationSigner,
} from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { formatB, formatUsdWhole } from "@/lib/format";

import { BImpactPreview } from "./b-impact-preview";
import { CategoryPicker, DeadlineControl } from "./create-market-fields";
import {
  LivePreviewPanel,
  ReviewPanel,
  SubmittedPanel,
  SuccessPanel,
} from "./create-market-panels";
import {
  createMarket,
  type CreateMarketWallet,
  submitMarketForReview,
  type SubmittedMarketReview,
} from "./create-market-service";
import {
  countErrors,
  focusFirstReviewError,
  getLiveDeadlineErrors,
} from "./review-errors";
import { getWalletCreateAction } from "./wallet-create-action";

type CreateMarketStage = "edit" | "review" | "submitted" | "success";

/**
 * Full market creation flow: draft editing with live validation, review,
 * optional AI-review submission, and creation (mock, server-signed, or
 * wallet-signed depending on the configured creation mode). `initialNow`
 * seeds the draft deadlines so server and client render the same times.
 */
export function CreateMarketForm({ initialNow }: { initialNow: string }) {
  const wallet = useWalletAccount();
  const contractConfig = getPopChartsContractConfig();
  const publicClient = usePublicClient({
    chainId: contractConfig?.chainId,
  });
  const { data: walletClient } = useWalletClient({
    chainId: contractConfig?.chainId,
  });
  const trustedCreatorRead = useReadContract({
    abi: pregradManagerAbi,
    address: contractConfig?.pregradManagerAddress,
    args: wallet.address ? [wallet.address as `0x${string}`] : undefined,
    chainId: contractConfig?.chainId,
    functionName: "isTrustedCreator",
    query: {
      enabled:
        marketCreationMode === "devchain" &&
        marketCreationSigner === "wallet" &&
        Boolean(contractConfig?.pregradManagerAddress && wallet.address),
    },
  });
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<CreateMarketDraft>(() =>
    createInitialMarketDraft(new Date(initialNow))
  );
  const [stage, setStage] = useState<CreateMarketStage>("edit");
  const [hasTriedReview, setHasTriedReview] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmittingForReview, setIsSubmittingForReview] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdMarket, setCreatedMarket] = useState<CreatedMarket | null>(null);
  const [submittedReview, setSubmittedReview] = useState<SubmittedMarketReview | null>(
    null
  );

  const walletCreationRequired =
    marketCreationMode === "devchain" && marketCreationSigner === "wallet";
  const trustedCreatorCanBypassAiResolution =
    walletCreationRequired && trustedCreatorRead.data === true;
  const effectiveDraft = trustedCreatorCanBypassAiResolution
    ? draft
    : { ...draft, bypassAiResolution: false };
  const validationErrors = validateCreateMarketDraft(effectiveDraft);
  const visibleErrors: CreateMarketValidationErrors =
    hasTriedReview || stage === "review"
      ? validationErrors
      : getLiveDeadlineErrors(validationErrors);
  const hasErrors = Object.keys(validationErrors).length > 0;
  const reviewErrorCount =
    hasTriedReview && stage === "edit" ? countErrors(validationErrors) : 0;
  const preview = buildCreateMarketPreview(effectiveDraft);
  const creationFeeLabel =
    marketCreationMode === "devchain"
      ? trustedCreatorCanBypassAiResolution
        ? "Waived"
        : "1 native USDC"
      : null;
  const createAction = walletCreationRequired
    ? getWalletCreateAction({
        contractChainId: contractConfig?.chainId ?? null,
        publicClientReady: Boolean(publicClient),
        wallet,
        walletClientReady: Boolean(walletClient),
      })
    : null;

  function updateDraft<K extends keyof CreateMarketDraft>(
    field: K,
    value: CreateMarketDraft[K]
  ) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setSubmitError(null);
    setSubmittedReview(null);

    if (stage === "review" || stage === "submitted") {
      setStage("edit");
    }
  }

  function updateDraftWith(updater: (current: CreateMarketDraft) => CreateMarketDraft) {
    setDraft(updater);
    setSubmitError(null);
    setSubmittedReview(null);

    if (stage === "review" || stage === "submitted") {
      setStage("edit");
    }
  }

  function applyGraduationPreset(preset: (typeof GRADUATION_PRESETS)[number]) {
    updateDraftWith((current) =>
      applyGraduationTime(
        current,
        toDateTimeLocalValue(new Date(Date.now() + preset.milliseconds)),
        preset.label
      )
    );
  }

  function applyResolutionPreset(preset: (typeof RESOLUTION_PRESETS)[number]) {
    updateDraftWith((current) =>
      applyResolutionTime(
        current,
        toDateTimeLocalValue(new Date(Date.now() + preset.milliseconds)),
        preset.label
      )
    );
  }

  function handleReview() {
    const nextErrors = validateCreateMarketDraft(effectiveDraft);
    setHasTriedReview(true);

    if (Object.keys(nextErrors).length > 0) {
      setStage("edit");
      focusFirstReviewError(nextErrors);
      return;
    }

    setStage("review");
  }

  async function handleSubmitForReview() {
    const nextErrors = validateCreateMarketDraft(draft);
    setHasTriedReview(true);

    if (Object.keys(nextErrors).length > 0) {
      setStage("edit");
      return;
    }

    setSubmitError(null);
    setIsSubmittingForReview(true);

    try {
      const result = await submitMarketForReview(draft);
      setSubmittedReview(result);
      setStage("submitted");
    } catch (error) {
      setSubmitError(getReviewSubmissionErrorMessage(error));
    } finally {
      setIsSubmittingForReview(false);
    }
  }

  async function handleCreate() {
    const nextErrors = validateCreateMarketDraft(effectiveDraft);
    setHasTriedReview(true);

    if (Object.keys(nextErrors).length > 0) {
      setStage("edit");
      return;
    }

    setSubmitError(null);

    if (createAction && createAction.kind !== "ready") {
      createAction.run();
      return;
    }

    setIsCreating(true);

    try {
      const walletContext =
        walletCreationRequired && wallet.address && publicClient && walletClient
          ? ({
              accountAddress: wallet.address as `0x${string}`,
              activeChainId: wallet.activeChainId,
              publicClient,
              walletClient,
            } satisfies CreateMarketWallet)
          : undefined;
      const result = await createMarket(
        effectiveDraft,
        walletContext ? { wallet: walletContext } : {}
      );
      setCreatedMarket(result);
      setStage("success");
    } catch (error) {
      setSubmitError(getCreateMarketErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  }

  function resetForm() {
    setAdvanced(false);
    setCreatedMarket(null);
    setDraft(createInitialMarketDraft());
    setHasTriedReview(false);
    setIsSubmittingForReview(false);
    setStage("edit");
    setSubmitError(null);
    setSubmittedReview(null);
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
            onEdit={() => setStage("edit")}
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
            onEdit={() => setStage("edit")}
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

function getCreateMarketErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The creation service could not create this market.";
}

function getReviewSubmissionErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The review service could not submit this market.";
}
