"use client";

import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

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
import { useTrustedCreatorStatus } from "@/integrations/contracts/hooks/use-trusted-creator-status";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

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
 * The create-market form's state machine: draft editing with live validation,
 * stage transitions (edit, review, submitted, success), AI-review submission,
 * and creation (mock, server-signed, or wallet-signed depending on the
 * configured creation mode), including the trusted-creator bypass read.
 * `initialNow` seeds the draft deadlines so server and client render the same
 * times. Returns state plus actions so the CreateMarketForm component stays
 * purely presentational.
 */
export function useCreateMarketFormState(initialNow: string) {
  const wallet = useWalletAccount();
  const contractConfig = getPopChartsContractConfig();
  const publicClient = usePublicClient({
    chainId: contractConfig?.chainId,
  });
  const { data: walletClient } = useWalletClient({
    chainId: contractConfig?.chainId,
  });
  const trustedCreatorRead = useTrustedCreatorStatus({
    walletAddress: wallet.address,
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

  function toggleAdvanced() {
    setAdvanced((current) => !current);
  }

  function returnToEdit() {
    setStage("edit");
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

  return {
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
  };
}

function getCreateMarketErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "create-market" },
    fallback: "The creation service could not create this market.",
  });
}

function getReviewSubmissionErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "submit-market-review" },
    fallback: "The review service could not submit this market.",
  });
}
