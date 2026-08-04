"use client";

import type {
  DraftFeedbackItem,
  MarketDraft,
  MarketDraftBondShortfall,
} from "@popcharts/api-client/models";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  formDraftToWrite,
  serverDraftToFormDraft,
  stableWrite,
  writeChangesServerDraft,
} from "@/domain/market-creation/draft-sync";
import type {
  CreateMarketDraft,
  CreateMarketValidationErrors,
} from "@/domain/market-creation/types";
import { subscribeToGeneratedMarketFill } from "@/features/dev-settings/generated-market-events";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import {
  createDraftsApiClient,
  type DraftsApiClient,
  DraftsApiError,
} from "@/integrations/indexer/drafts-api";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

import type { CreateMarketWallet } from "./draft-publish-service";
import { applyGeneratedMarketToDraft } from "./dev-autofill";
import {
  persistPublishedMetadata,
  publishDraftMarket,
  type PublishedDraftMarket,
} from "./draft-publish-service";
import {
  countErrors,
  focusFirstReviewError,
  getLiveDeadlineErrors,
} from "./review-errors";
import { getWalletCreateAction } from "./wallet-create-action";

/** How the aside panel reads the flow at a glance. */
export type DraftFlowStage =
  | "approved"
  | "editing"
  | "feedback"
  | "in_review"
  | "published";

const AUTOSAVE_DEBOUNCE_MS = 800;
const REVIEW_POLL_MS = 1_200;

/**
 * The review-first create flow (ADR 0022): a locally edited form that
 * autosaves to a server draft once a wallet is connected, submits for AI
 * review, streams the verdict back with actionable feedback, and — once
 * approved — publishes on-chain with server-minted publish-time params.
 * Presentation stays in the components; every transition lives here.
 */
export function useCreateDraftFlow({
  initialDraftId = null,
  initialNow,
}: {
  initialDraftId?: number | null;
  initialNow: string;
}) {
  const wallet = useWalletAccount();
  const contractConfig = getPopChartsContractConfig();
  const publicClient = usePublicClient({ chainId: contractConfig?.chainId });
  const { data: walletClient } = useWalletClient({
    chainId: contractConfig?.chainId,
  });
  // The draft owner is the wallet identity's user id (Privy DID in
  // production, wallet address on the local stack); the wallet address is
  // separate — it is what will sign the publish transaction.
  const owner = wallet.ownerUserId;
  const creatorAddress = wallet.address?.toLowerCase() ?? null;
  const getDraftAuthHeaders = wallet.getDraftAuthHeaders;
  const client = useMemo<DraftsApiClient | null>(
    () =>
      owner ? createDraftsApiClient({ getAuthHeaders: getDraftAuthHeaders }) : null,
    [getDraftAuthHeaders, owner]
  );

  const [advanced, setAdvanced] = useState(false);
  const [formDraft, setFormDraft] = useState<CreateMarketDraft>(() =>
    createInitialMarketDraft(new Date(initialNow))
  );
  const [serverDraft, setServerDraft] = useState<MarketDraft | null>(null);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [publishedMarket, setPublishedMarket] = useState<PublishedDraftMarket | null>(
    null
  );
  const [templateSaved, setTemplateSaved] = useState(false);
  const [bondShortfall, setBondShortfall] = useState<MarketDraftBondShortfall | null>(
    null
  );
  const [loadedDraftId, setLoadedDraftId] = useState<number | null>(null);
  const skipNextAutosave = useRef(false);
  // Monotonic save generation: every save (and submit, which supersedes any
  // save) bumps it, and a response is applied only while its generation is
  // still current — a slow older PATCH can never overwrite a newer one.
  const saveSeq = useRef(0);
  // The autosave request currently on the wire, if any. Submit awaits it
  // before flushing so the two writes never race server-side — the version
  // guard there would surface a conflict banner for what is really just one
  // client typing quickly.
  const inflightSave = useRef<Promise<unknown> | null>(null);

  // Loading is derived, never set synchronously: the draft is "loading" until
  // the fetch keyed by (initialDraftId, client) lands and records its id.
  const isLoadingDraft =
    initialDraftId !== null && client !== null && loadedDraftId !== initialDraftId;

  // Local dev only: the dev menu generates a market and announces it on the
  // window event bus. Filling replaces every validated field, so any earlier
  // submit-attempt errors no longer describe this draft; the autosave effect
  // then persists the fill like any other edit.
  useEffect(
    () =>
      subscribeToGeneratedMarketFill((market) => {
        setFormDraft((current) => applyGeneratedMarketToDraft(current, market));
        setHasTriedSubmit(false);
        setFlowError(null);
      }),
    []
  );

  // ---- Load an existing draft (studio "Open", template "Use") -------------
  useEffect(() => {
    if (initialDraftId === null || !client || loadedDraftId === initialDraftId) {
      return;
    }

    let cancelled = false;

    void client
      .get(initialDraftId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        if (loaded) {
          skipNextAutosave.current = true;
          setServerDraft(loaded);
          setFormDraft(serverDraftToFormDraft(loaded, new Date()));
          setSavedAt(loaded.updatedAt);
        } else {
          setFlowError("That draft could not be found — starting fresh.");
        }

        setLoadedDraftId(initialDraftId);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFlowError(describeError(error, "load-draft"));
          setLoadedDraftId(initialDraftId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, initialDraftId, loadedDraftId]);

  // ---- Autosave ------------------------------------------------------------
  useEffect(() => {
    if (!client || isLoadingDraft) {
      return;
    }

    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }

    if (serverDraft && !isEditableStatus(serverDraft.status)) {
      return;
    }

    // Never create a server draft for an untouched form — visiting the page
    // should not leave an untitled draft behind in the studio.
    if (!serverDraft && !hasMeaningfulContent(formDraft)) {
      return;
    }

    const write = stableWrite(formDraftToWrite(formDraft, new Date()), serverDraft);

    if (serverDraft && !writeChangesServerDraft(write, serverDraft)) {
      return;
    }

    const timer = window.setTimeout(() => {
      const seq = ++saveSeq.current;

      setIsSaving(true);
      setFlowError(null);

      const save = serverDraft
        ? client.update(serverDraft.id, write)
        : client.create({
            ...write,
            intendedCreatorAddress: creatorAddress,
          });

      inflightSave.current = save.catch(() => undefined);

      save
        .then((saved) => {
          if (seq !== saveSeq.current) {
            return;
          }

          skipNextAutosave.current = true;
          setServerDraft(saved);
          setSavedAt(saved.updatedAt);
        })
        .catch((error: unknown) => {
          if (seq === saveSeq.current) {
            setFlowError(describeError(error, "save-draft"));
          }
        })
        .finally(() => {
          if (seq === saveSeq.current) {
            setIsSaving(false);
          }
        });
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [client, creatorAddress, formDraft, isLoadingDraft, serverDraft]);

  // ---- Poll while the review runs -----------------------------------------
  useEffect(() => {
    if (!client || serverDraft?.status !== "in_review") {
      return;
    }

    const draftId = serverDraft.id;
    const interval = window.setInterval(() => {
      void client
        .get(draftId)
        .then((latest) => {
          if (latest) {
            setServerDraft(latest);
          }
        })
        .catch(() => {
          // Poll failures are transient; the next tick retries.
        });
    }, REVIEW_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [client, serverDraft?.id, serverDraft?.status]);

  // ---- Derived state -------------------------------------------------------
  const validationErrors = validateCreateMarketDraft(formDraft);
  const visibleErrors: CreateMarketValidationErrors = hasTriedSubmit
    ? validationErrors
    : getLiveDeadlineErrors(validationErrors);
  const errorCount = hasTriedSubmit ? countErrors(validationErrors) : 0;
  const preview = buildCreateMarketPreview(formDraft);
  const latestReview = serverDraft?.latestReview ?? null;
  const stage = deriveStage(serverDraft, publishedMarket);
  const formLocked = stage === "in_review" || stage === "published";
  const fieldFeedback = groupFeedbackByField(stage, latestReview?.feedback.items ?? []);
  const walletAction = getWalletCreateAction({
    contractChainId: contractConfig?.chainId ?? null,
    publicClientReady: Boolean(publicClient),
    wallet,
    walletClientReady: Boolean(walletClient),
  });

  // ---- Form actions --------------------------------------------------------
  function updateDraft<K extends keyof CreateMarketDraft>(
    field: K,
    value: CreateMarketDraft[K]
  ) {
    setFormDraft((current) => ({ ...current, [field]: value }));
    setFlowError(null);
  }

  function updateDraftWith(updater: (current: CreateMarketDraft) => CreateMarketDraft) {
    setFormDraft(updater);
    setFlowError(null);
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

  // ---- Flow actions --------------------------------------------------------
  async function submitForReview() {
    if (!client) {
      setFlowError("Connect a wallet to submit drafts for review.");
      return;
    }

    setHasTriedSubmit(true);

    const errors = validateCreateMarketDraft(formDraft);

    if (Object.keys(errors).length > 0) {
      focusFirstReviewError(errors);
      return;
    }

    setIsSubmitting(true);
    setFlowError(null);
    // Submit supersedes any in-flight autosave: its response is dropped so a
    // slow PATCH can never overwrite what this flush is about to persist —
    // and the request itself is awaited so the flush never races it into the
    // server's version guard.
    saveSeq.current += 1;
    await inflightSave.current;

    try {
      // Flush any unsaved edits so the review sees exactly what's on screen.
      const write = formDraftToWrite(formDraft, new Date());
      const current = serverDraft;
      const saved = current
        ? await client.update(current.id, stableWrite(write, current))
        : await client.create({ ...write, intendedCreatorAddress: creatorAddress });
      skipNextAutosave.current = true;
      const submitted = await client.submit(saved.id);
      setServerDraft(submitted);
      setSavedAt(submitted.updatedAt);
      setBondShortfall(null);
    } catch (error) {
      // A meter refusal is a prompt to fund the bond, not an error banner:
      // the shortfall panel takes over the aside with a one-click deposit.
      if (error instanceof DraftsApiError && error.bondShortfall) {
        setBondShortfall(error.bondShortfall);
      } else {
        setFlowError(describeError(error, "submit-draft"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function publish() {
    if (!client || !serverDraft) {
      setFlowError("Connect a wallet to publish.");
      return;
    }

    if (walletAction && walletAction.kind !== "ready") {
      walletAction.run();
      return;
    }

    if (!wallet.address || !publicClient || !walletClient) {
      setFlowError("Connect a wallet to publish.");
      return;
    }

    const draftId = serverDraft.id;

    setIsPublishing(true);
    setFlowError(null);

    try {
      const creatorAddress = wallet.address as `0x${string}`;
      const params = await client.publishParams(draftId, creatorAddress);
      const walletContext: CreateMarketWallet = {
        accountAddress: creatorAddress,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      };
      const published = await publishDraftMarket({
        params,
        // An authorization left on a wallet prompt past its 15-minute window
        // is re-minted transparently — minting is free (ADR 0022 P4).
        remint: () => client.publishParams(draftId, creatorAddress),
        wallet: walletContext,
      });

      await persistPublishedMetadata({
        chainId: published.chainId,
        metadataHash: params.metadataHash,
        metadataPayload: params.metadata,
      });

      const recorded = await client.markPublished(draftId, {
        chainId: published.chainId,
        marketId: published.marketId,
        transactionHash: published.transactionHash,
      });

      setServerDraft(recorded.draft);
      setPublishedMarket(published);
    } catch (error) {
      setFlowError(describeError(error, "publish-draft"));
    } finally {
      setIsPublishing(false);
    }
  }

  function returnToEditing() {
    // Editing a reviewed draft is allowed server-side; the first content
    // change moves it back to `editing` and clears the snapshot. Locally we
    // just surface the form again — the feedback stays alongside it.
    document.getElementById("question")?.focus();
  }

  function clearBondShortfall() {
    setBondShortfall(null);
  }

  function startFresh() {
    skipNextAutosave.current = true;
    setBondShortfall(null);
    setServerDraft(null);
    setPublishedMarket(null);
    setFormDraft(createInitialMarketDraft());
    setHasTriedSubmit(false);
    setSavedAt(null);
    setFlowError(null);
    setAdvanced(false);
    setTemplateSaved(false);
  }

  async function saveAsTemplate() {
    const current = serverDraft;

    if (!client || !current) {
      return;
    }

    try {
      await client.clone({ asTemplate: true, fromDraftId: current.id });
      setTemplateSaved(true);
    } catch (error) {
      setFlowError(describeError(error, "save-template"));
    }
  }

  return {
    advanced,
    applyGraduationPreset,
    applyResolutionPreset,
    bondShortfall,
    clearBondShortfall,
    canPersist: Boolean(client),
    /** Reads the intended creator's credit position; null until both exist. */
    fetchCredit:
      client && serverDraft?.intendedCreatorAddress
        ? () => client.credit(serverDraft.intendedCreatorAddress!)
        : null,
    errorCount,
    fieldFeedback,
    flowError,
    formDraft,
    formLocked,
    isLoadingDraft,
    isPublishing,
    isSaving,
    isSubmitting,
    latestReview,
    preview,
    publish,
    publishedMarket,
    returnToEditing,
    saveAsTemplate,
    savedAt,
    serverDraft,
    stage,
    startFresh,
    submitForReview,
    templateSaved,
    toggleAdvanced: () => setAdvanced((current) => !current),
    updateDraft,
    updateDraftWith,
    visibleErrors,
    walletAction,
  };
}

function deriveStage(
  serverDraft: MarketDraft | null,
  publishedMarket: PublishedDraftMarket | null
): DraftFlowStage {
  if (publishedMarket || serverDraft?.status === "published") {
    return "published";
  }

  if (serverDraft?.status === "in_review") {
    return "in_review";
  }

  if (serverDraft?.status === "approved") {
    return "approved";
  }

  if (
    serverDraft?.status === "changes_requested" ||
    serverDraft?.status === "rejected"
  ) {
    return "feedback";
  }

  // The first edit after a verdict flips the stored status back to `editing`,
  // but the creator is mid-fix — keep the feedback on screen until the draft
  // is resubmitted or the review was an approval.
  if (
    serverDraft?.status === "editing" &&
    serverDraft.latestReview &&
    serverDraft.latestReview.verdict !== "approve"
  ) {
    return "feedback";
  }

  return "editing";
}

/** True once the creator has typed anything worth keeping. */
function hasMeaningfulContent(draft: CreateMarketDraft): boolean {
  return [
    draft.description,
    draft.outcomeNo,
    draft.outcomeYes,
    draft.question,
    draft.resolutionCriteria,
    draft.resolutionSources,
  ].some((value) => value.trim().length > 0);
}

function isEditableStatus(status: MarketDraft["status"]): boolean {
  return (
    status === "editing" ||
    status === "changes_requested" ||
    status === "rejected" ||
    status === "approved"
  );
}

/**
 * Feedback items keyed by the form field they concern, shown inline under the
 * fields while the creator fixes a flagged draft. Cleared once the draft is
 * approved or republished so stale advice never lingers.
 */
function groupFeedbackByField(
  stage: DraftFlowStage,
  items: DraftFeedbackItem[]
): Partial<Record<string, DraftFeedbackItem[]>> {
  if (stage !== "feedback") {
    return {};
  }

  const grouped: Partial<Record<string, DraftFeedbackItem[]>> = {};

  for (const item of items) {
    if (!item.field) {
      continue;
    }

    (grouped[item.field] ??= []).push(item);
  }

  return grouped;
}

function describeError(error: unknown, operation: string): string {
  // DraftsApiError is a DisplayableError, so the draft API's own copy passes
  // through; anything else logs and falls back to curated copy.
  return presentError(error, {
    context: { operation: `draft-flow/${operation}` },
    fallback: "The draft service hit a snag — try again.",
  });
}
