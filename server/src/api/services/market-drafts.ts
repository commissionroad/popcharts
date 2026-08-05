import { parseEventLogs } from "viem";

import { pregradManagerAbi } from "@popcharts/protocol";

import {
  mintPublishAuthorization,
  type SerializedPublishAuthorization,
} from "src/api/services/publish-authorization";
import type {
  ReviewProviderName,
  ReviewResult,
  ReviewScoreRationales,
  ReviewScores,
  ReviewVerdict,
} from "src/ai-review/types";
import { createReadOnlyClient } from "src/blockchain/client";
import { config, ZERO_ADDRESS } from "src/config";
import { and, db, desc, eq, inArray, schema, sql } from "src/db/client";
import type { DraftReviewFeedback } from "src/db/schema/market-draft-reviews";
import type {
  MarketDraftRow,
  MarketDraftStatus,
} from "src/db/schema/market-drafts";
import {
  lockWalletCredit,
  quoteReviewRun,
} from "src/draft-review/review-credit-meter";
import {
  buildDraftMetadata,
  validateDraftForSubmission,
  type DraftValidationErrors,
} from "src/draft-review/content";
import { buildDraftReviewFeedback } from "src/draft-review/feedback";
import { isDraftPublicId, newDraftPublicId } from "src/drafts/public-id";

const WAD = 10n ** 18n;
/** Matches the app's derivation: graduation target = 0.5 × b, in collateral. */
const GRADUATION_THRESHOLD_MULTIPLE_BPS = 5_000n;

/** Statuses a creator may edit content in; editing any of them resets to editing. */
const EDITABLE_STATUSES: MarketDraftStatus[] = [
  "editing",
  "changes_requested",
  "rejected",
  "approved",
];

/** Statuses submit accepts; approved resubmits are how an edit re-reviews. */
const SUBMITTABLE_STATUSES: MarketDraftStatus[] = [
  "editing",
  "changes_requested",
  "rejected",
];

/** The content fields a creator can write through create/update. */
export type MarketDraftContentPatch = Partial<{
  category: string;
  description: string;
  graduationWindowSeconds: number;
  intendedCreatorAddress: string | null;
  isTemplate: boolean;
  liquidityParameter: number;
  openingProbability: number;
  outcomeNo: string;
  outcomeYes: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources: string;
  resolutionUrl: string;
  resolutionWindowSeconds: number;
}>;

type DraftReviewRow = typeof schema.marketDraftReviews.$inferSelect;

/** Serialized review the draft surfaces carry: feedback plus audit fields. */
export type MarketDraftReviewResponse = {
  feedback: DraftReviewFeedback;
  id: number;
  metadataHash: string;
  modelId: string | null;
  provider: ReviewProviderName;
  reasons: string[];
  reviewedAt: string;
  scoreRationales: ReviewScoreRationales;
  scores: ReviewScores;
  verdict: ReviewVerdict;
};

/** Serialized draft as the API returns it. */
export type MarketDraftResponse = {
  category: string;
  createdAt: string;
  description: string;
  graduationWindowSeconds: number;
  id: string;
  intendedCreatorAddress: string | null;
  isTemplate: boolean;
  latestReview?: MarketDraftReviewResponse;
  liquidityParameter: number;
  openingProbability: number;
  outcomeNo: string;
  outcomeYes: string;
  publishedAt: string | null;
  publishedChainId: number | null;
  publishedMarketId: string | null;
  publishedTransactionHash: string | null;
  question: string;
  resolutionCriteria: string;
  resolutionSources: string;
  resolutionUrl: string;
  resolutionWindowSeconds: number;
  reviewedAt: string | null;
  status: MarketDraftStatus;
  submittedAt: string | null;
  updatedAt: string;
};

export function serializeMarketDraft(
  draft: MarketDraftRow,
  latestReview: DraftReviewRow | null,
): MarketDraftResponse {
  return {
    category: draft.category,
    createdAt: draft.createdAt.toISOString(),
    description: draft.description,
    graduationWindowSeconds: draft.graduationWindowSeconds,
    id: draft.publicId,
    intendedCreatorAddress: draft.intendedCreatorAddress,
    isTemplate: draft.isTemplate,
    ...(latestReview
      ? { latestReview: serializeDraftReview(latestReview) }
      : {}),
    liquidityParameter: draft.liquidityParameter,
    openingProbability: draft.openingProbability,
    outcomeNo: draft.outcomeNo,
    outcomeYes: draft.outcomeYes,
    publishedAt: draft.publishedAt?.toISOString() ?? null,
    publishedChainId: draft.publishedChainId,
    publishedMarketId: draft.publishedMarketId?.toString() ?? null,
    publishedTransactionHash: draft.publishedTransactionHash,
    question: draft.question,
    resolutionCriteria: draft.resolutionCriteria,
    resolutionSources: draft.resolutionSources,
    resolutionUrl: draft.resolutionUrl,
    resolutionWindowSeconds: draft.resolutionWindowSeconds,
    reviewedAt: draft.reviewedAt?.toISOString() ?? null,
    status: draft.status,
    submittedAt: draft.submittedAt?.toISOString() ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export function serializeDraftReview(
  review: DraftReviewRow,
): MarketDraftReviewResponse {
  return {
    feedback: review.feedback,
    id: review.id,
    metadataHash: review.metadataHash,
    modelId: review.modelId,
    provider: review.provider,
    reasons: review.reasons,
    reviewedAt: review.reviewedAt.toISOString(),
    scoreRationales: review.scoreRationales,
    scores: review.scores,
    verdict: review.verdict,
  };
}

/** Lists the owner's live (non-deleted) drafts, most recently touched first. */
export async function listMarketDrafts({
  owner,
}: {
  owner: string;
}): Promise<MarketDraftResponse[]> {
  const drafts = await db
    .select()
    .from(schema.marketDrafts)
    .where(
      and(
        eq(schema.marketDrafts.ownerUserId, owner),
        eq(schema.marketDrafts.deleted, false),
      ),
    )
    .orderBy(desc(schema.marketDrafts.updatedAt));
  const reviewsByDraft = await latestReviewsFor(drafts.map((d) => d.id));

  return drafts.map((draft) =>
    serializeMarketDraft(draft, reviewsByDraft.get(draft.id) ?? null),
  );
}

export type GetMarketDraftResult =
  { draft: MarketDraftResponse; kind: "found" } | { kind: "not_found" };

/** Reads one of the owner's drafts with its latest review. */
export async function getMarketDraft({
  draftId,
  owner,
}: {
  draftId: string;
  owner: string;
}): Promise<GetMarketDraftResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  const reviews = await latestReviewsFor([draft.id]);

  return {
    draft: serializeMarketDraft(draft, reviews.get(draft.id) ?? null),
    kind: "found",
  };
}

/** Creates a fresh editing draft (optionally a template) for the owner. */
export async function createMarketDraft({
  content = {},
  owner,
}: {
  content?: MarketDraftContentPatch;
  owner: string;
}): Promise<MarketDraftResponse> {
  const [draft] = await db
    .insert(schema.marketDrafts)
    .values({
      ownerUserId: owner,
      publicId: newDraftPublicId(),
      ...contentColumns(content),
    })
    .returning();

  return serializeMarketDraft(assertRow(draft), null);
}

export type UpdateMarketDraftResult =
  | { draft: MarketDraftResponse; kind: "updated" }
  | { kind: "not_found" }
  | { kind: "locked"; message: string };

/**
 * Updates a draft's content. Any content edit invalidates prior review state:
 * the draft returns to `editing` and its snapshot hash clears, so a stale
 * approval can never publish changed text (ADR 0022 §4). Drafts locked
 * in-review or already published refuse edits.
 */
export async function updateMarketDraft({
  draftId,
  owner,
  patch,
}: {
  draftId: string;
  owner: string;
  patch: MarketDraftContentPatch;
}): Promise<UpdateMarketDraftResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  if (!EDITABLE_STATUSES.includes(draft.status)) {
    return {
      kind: "locked",
      message:
        draft.status === "in_review"
          ? "This draft is being reviewed — it unlocks when the review lands."
          : "Published drafts are read-only. Clone it to keep iterating.",
    };
  }

  const columns = contentColumns(patch);
  const contentChanged = draftContentChanges(draft, columns);
  // Conditional on the status and version observed above, so a transition
  // that lands between the read and this write (a concurrent submit locking
  // the draft, another tab's edit) turns into a conflict instead of a write
  // against a state this handler never checked.
  const [updated] = await db
    .update(schema.marketDrafts)
    .set({
      ...columns,
      updatedAt: new Date(),
      ...(contentChanged && draft.status !== "editing"
        ? { status: "editing" as const, submittedMetadataHash: null }
        : {}),
    })
    .where(
      and(
        eq(schema.marketDrafts.id, draft.id),
        eq(schema.marketDrafts.status, draft.status),
        draftVersionMatches(draft),
      ),
    )
    .returning();

  if (!updated) {
    return {
      kind: "locked",
      message: "This draft just changed elsewhere — reload and try again.",
    };
  }

  const reviews = await latestReviewsFor([draft.id]);

  return {
    draft: serializeMarketDraft(updated, reviews.get(draft.id) ?? null),
    kind: "updated",
  };
}

export type DeleteMarketDraftResult =
  { kind: "deleted" } | { kind: "not_found" };

/** Soft-deletes (hides) a draft; the row lingers per ADR 0022. */
export async function deleteMarketDraft({
  draftId,
  owner,
}: {
  draftId: string;
  owner: string;
}): Promise<DeleteMarketDraftResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  await db
    .update(schema.marketDrafts)
    .set({ deleted: true, updatedAt: new Date() })
    .where(eq(schema.marketDrafts.id, draft.id));

  return { kind: "deleted" };
}

export type CloneMarketDraftSource =
  | { draftId: string; kind: "draft" }
  | { chainId: number; kind: "market"; marketId: bigint };

export type CloneMarketDraftResult =
  | { draft: MarketDraftResponse; kind: "cloned" }
  | { kind: "not_found"; message: string };

/**
 * The universal clone (ADR 0022 §9): seeds a new editing draft verbatim from
 * one of the owner's drafts or from any indexed market. Deadline windows come
 * from the source market's actual spans when cloning a market.
 */
export async function cloneMarketDraft({
  asTemplate = false,
  owner,
  source,
}: {
  asTemplate?: boolean;
  owner: string;
  source: CloneMarketDraftSource;
}): Promise<CloneMarketDraftResult> {
  const content =
    source.kind === "draft"
      ? await draftCloneContent(owner, source.draftId)
      : await marketCloneContent(source.chainId, source.marketId);

  if (!content) {
    return {
      kind: "not_found",
      message:
        source.kind === "draft"
          ? "That draft does not exist."
          : "No market with that id is indexed here.",
    };
  }

  const [draft] = await db
    .insert(schema.marketDrafts)
    .values({
      ownerUserId: owner,
      publicId: newDraftPublicId(),
      ...contentColumns({ ...content, isTemplate: asTemplate }),
    })
    .returning();

  return {
    draft: serializeMarketDraft(assertRow(draft), null),
    kind: "cloned",
  };
}

export type SubmitMarketDraftResult =
  | { draft: MarketDraftResponse; kind: "submitted" }
  | { errors: DraftValidationErrors; kind: "invalid" }
  | {
      availableWad: bigint;
      kind: "insufficient_bond";
      requiredWad: bigint;
      runsUsed: number;
    }
  | { kind: "missing_wallet" }
  | { kind: "not_found" }
  | { kind: "wrong_status"; message: string };

export type SubmitMarketDraftDependencies = {
  quoteCharge: typeof quoteReviewRun;
};

const defaultSubmitDependencies: SubmitMarketDraftDependencies = {
  quoteCharge: quoteReviewRun,
};

/**
 * Submits a draft for AI review: validates completeness, prices the review
 * run against the creator's prepaid credit (the meter refuses before any
 * provider money is spent), snapshots the content hash, locks the draft in
 * `in_review`, and enqueues a review job for the runner, recording the meter
 * charge in the same transaction. Resubmitting after edits produces a fresh
 * hash and a fresh review.
 *
 * The quote runs *inside* the transaction, serialized per wallet by
 * {@link lockWalletCredit}: the balance read and the charge insert are not
 * otherwise atomic, so two drafts submitting concurrently for one wallet
 * would each see the same remaining run and together overspend it. The lock
 * makes the second submit wait, re-read the balance with the first charge
 * committed, and get refused honestly.
 */
export async function submitMarketDraft(
  {
    draftId,
    owner,
  }: {
    draftId: string;
    owner: string;
  },
  dependencies: SubmitMarketDraftDependencies = defaultSubmitDependencies,
): Promise<SubmitMarketDraftResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  if (!SUBMITTABLE_STATUSES.includes(draft.status)) {
    return {
      kind: "wrong_status",
      message:
        draft.status === "in_review"
          ? "This draft is already in review."
          : draft.status === "approved"
            ? "This draft is already approved — publish it, or edit it to trigger a fresh review."
            : "Published drafts can't be resubmitted. Clone it instead.",
    };
  }

  const errors = validateDraftForSubmission(draft);

  if (Object.keys(errors).length > 0) {
    return { errors, kind: "invalid" };
  }

  const { metadataHash } = buildDraftMetadata(draft);
  const now = new Date();
  const outcome = await db.transaction(
    async (tx): Promise<SubmitMarketDraftResult | { row: MarketDraftRow }> => {
      if (draft.intendedCreatorAddress) {
        await lockWalletCredit(tx, draft.intendedCreatorAddress);
      }

      const quote = await dependencies.quoteCharge({ dbc: tx, draft });

      if (quote.kind === "missing_wallet") {
        return { kind: "missing_wallet" };
      }

      if (quote.kind === "insufficient") {
        return {
          availableWad: quote.availableWad,
          kind: "insufficient_bond",
          requiredWad: quote.requiredWad,
          runsUsed: quote.runsUsed,
        };
      }

      // Conditional on the state and version observed above: the validated
      // content and the snapshot hash were computed from that read, so a
      // concurrent edit or duplicate submit must turn into a conflict rather
      // than enqueue a review of content nobody checked.
      const [row] = await tx
        .update(schema.marketDrafts)
        .set({
          status: "in_review",
          submittedAt: now,
          submittedMetadataHash: metadataHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.marketDrafts.id, draft.id),
            eq(schema.marketDrafts.status, draft.status),
            draftVersionMatches(draft),
          ),
        )
        .returning();

      if (!row) {
        return {
          kind: "wrong_status",
          message: "This draft just changed elsewhere — reload and try again.",
        };
      }

      await tx.insert(schema.marketDraftReviewJobs).values({
        draftId: draft.id,
        metadataHash,
      });

      // The meter charge rides the same transaction as the job it pays for:
      // a conflicted submit charges nothing, a charged submit always has its
      // job. Credit is non-refundable, so this row is final — there is no
      // settlement to reconcile it against and nothing reverses it.
      if (quote.kind === "chargeable" && draft.intendedCreatorAddress) {
        await tx.insert(schema.draftReviewCharges).values({
          amount: quote.amountWad,
          chargedAddress: draft.intendedCreatorAddress.toLowerCase(),
          draftId: draft.id,
          kind: "review_run",
          rate: quote.rateWad,
        });
      }

      return { row };
    },
  );

  if (!("row" in outcome)) {
    return outcome;
  }

  const reviews = await latestReviewsFor([draft.id]);

  return {
    draft: serializeMarketDraft(outcome.row, reviews.get(draft.id) ?? null),
    kind: "submitted",
  };
}

/** A database handle the review-apply helper can write through: the process
 * `db` or the runner's enclosing transaction (see the runner's fenced
 * completion). */
export type DraftReviewWriter =
  typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Runner-facing: records a completed review and moves the draft out of
 * `in_review`. Guarded on the draft still being in review of the same content
 * snapshot, so a late result for edited content is recorded but changes
 * nothing. Callers that must couple this to other writes (the runner's job
 * completion) pass their transaction as `writer`.
 */
export async function applyDraftReviewResult(
  {
    draftId,
    metadataHash,
    result,
  }: {
    draftId: number;
    metadataHash: string;
    result: ReviewResult;
  },
  writer: DraftReviewWriter = db,
): Promise<{ reviewId: number }> {
  // Standalone calls stay atomic: the review row and the draft transition
  // must land together, so without an enclosing transaction we open one.
  if (writer === db) {
    return db.transaction((tx) =>
      applyDraftReviewResult({ draftId, metadataHash, result }, tx),
    );
  }

  const feedback = buildDraftReviewFeedback(result);
  const now = new Date();
  const nextStatus: MarketDraftStatus =
    result.verdict === "approve"
      ? "approved"
      : result.verdict === "reject"
        ? "rejected"
        : "changes_requested";

  const [review] = await writer
    .insert(schema.marketDraftReviews)
    .values({
      draftId,
      evidence: result.evidence,
      feedback,
      hardFlags: result.hardFlags,
      metadataHash,
      ...(result.modelId ? { modelId: result.modelId } : {}),
      promptVersion: result.promptVersion,
      provider: result.provider,
      reasons: result.reasons,
      reviewedAt: now,
      scoreRationales: result.scoreRationales,
      scores: result.scores,
      sourceChecks: result.sourceChecks,
      verdict: result.verdict,
    })
    .returning();
  await writer
    .update(schema.marketDrafts)
    .set({ reviewedAt: now, status: nextStatus, updatedAt: now })
    .where(
      and(
        eq(schema.marketDrafts.id, draftId),
        eq(schema.marketDrafts.status, "in_review"),
        eq(schema.marketDrafts.submittedMetadataHash, metadataHash),
      ),
    );

  return { reviewId: assertRow(review).id };
}

/** The publish payload: wire-serialized createMarket params minus collateral,
 * which the app fills from its own chain config. */
export type DraftPublishParams = {
  bypassAiResolution: boolean;
  collateral: string;
  graduationDeadline: string;
  graduationThreshold: string;
  liquidityParameter: string;
  metadata: string;
  metadataHash: string;
  openingProbabilityWad: string;
  resolutionTime: string;
  yesNotBefore: string;
};

export type BuildDraftPublishParamsResult =
  | {
      kind: "ready";
      params: DraftPublishParams;
      /** Present when this deployment can sign (ADR 0022 P4); absent unarmed. */
      authorization?: SerializedPublishAuthorization;
    }
  | { kind: "content_changed"; message: string }
  | { kind: "not_found" }
  | { kind: "wrong_status"; message: string };

/**
 * Mints the publish payload at publish time (ADR 0022 §4): re-checks the draft
 * is still approved and unchanged, then resolves the stored relative windows
 * into absolute deadlines anchored at the current chain time — so an approved
 * draft that lingered for weeks still publishes with full windows.
 */
export async function buildDraftPublishParams({
  creatorAddress,
  draftId,
  owner,
}: {
  /** Wallet that will send createMarket; binds the minted authorization. */
  creatorAddress?: `0x${string}`;
  draftId: string;
  owner: string;
}): Promise<BuildDraftPublishParamsResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  if (draft.status !== "approved") {
    return {
      kind: "wrong_status",
      message: "Only approved drafts can be published.",
    };
  }

  const { metadataHash, metadataPayload } = buildDraftMetadata(draft);

  if (metadataHash !== draft.submittedMetadataHash) {
    return {
      kind: "content_changed",
      message:
        "The draft changed since its approval — submit it for a fresh review first.",
    };
  }

  const nowSeconds = await currentChainSeconds();
  const graduationDeadline = nowSeconds + BigInt(draft.graduationWindowSeconds);
  const resolutionTime = nowSeconds + BigInt(draft.resolutionWindowSeconds);
  const liquidityParameter = wholeToWad(draft.liquidityParameter);
  const openingProbabilityWad = (BigInt(draft.openingProbability) * WAD) / 100n;
  const graduationThreshold =
    (liquidityParameter * GRADUATION_THRESHOLD_MULTIPLE_BPS) / 10_000n;
  const collateral = config.contracts.collateral;
  // No early-YES control on drafts yet; gate YES at the resolution deadline,
  // matching the create form (ADR 0012 slice 2).
  const yesNotBefore = resolutionTime;

  // The signature must cover the exact values the app will submit, so it is
  // minted over the same resolved bigints this response serializes — never
  // re-derived from the draft later. Absent when this deployment cannot sign
  // or the caller did not say which wallet publishes (the authorization binds
  // the creator, so there is nothing to mint without one).
  const authorization =
    creatorAddress && collateral !== ZERO_ADDRESS
      ? await mintPublishAuthorization({
          chainSeconds: nowSeconds,
          creator: creatorAddress,
          params: {
            bypassAiResolution: false,
            collateral,
            graduationDeadline,
            graduationThreshold,
            liquidityParameter,
            metadata: metadataPayload,
            metadataHash: metadataHash as `0x${string}`,
            openingProbabilityWad,
            resolutionTime,
            yesNotBefore,
          },
        })
      : undefined;

  return {
    authorization,
    kind: "ready",
    params: {
      bypassAiResolution: false,
      collateral,
      graduationDeadline: graduationDeadline.toString(),
      graduationThreshold: graduationThreshold.toString(),
      liquidityParameter: liquidityParameter.toString(),
      metadata: metadataPayload,
      metadataHash,
      openingProbabilityWad: openingProbabilityWad.toString(),
      resolutionTime: resolutionTime.toString(),
      yesNotBefore: yesNotBefore.toString(),
    },
  };
}

export type MarkMarketDraftPublishedResult =
  | {
      draft: MarketDraftResponse;
      kind: "published";
    }
  | { kind: "not_found" }
  | { kind: "verification_failed"; message: string }
  | { kind: "wrong_status"; message: string };

export type PublishReceiptVerification =
  { kind: "verified" } | { kind: "failed"; message: string };

/**
 * Confirms on-chain that the claimed publish transaction really created the
 * claimed market with EXACTLY the approved draft's content: the receipt must
 * carry a MarketCreated event from our PregradManager whose marketId matches
 * and whose metadataHash equals the draft's reviewed snapshot. Without this,
 * the caller-supplied ids would let any owner of one approved draft point
 * "published" at an unrelated market and have the bridge approve it.
 */
async function verifyPublishReceipt({
  chainId,
  metadataHash,
  marketId,
  transactionHash,
}: {
  chainId: number;
  metadataHash: string;
  marketId: bigint;
  transactionHash: string;
}): Promise<PublishReceiptVerification> {
  if (chainId !== config.chainId) {
    return {
      kind: "failed",
      message: `This API serves chain ${config.chainId}, not ${chainId}.`,
    };
  }

  let logs;

  try {
    const receipt = await createReadOnlyClient().getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      return { kind: "failed", message: "The publish transaction reverted." };
    }

    logs = parseEventLogs({
      abi: pregradManagerAbi,
      eventName: "MarketCreated",
      logs: receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() ===
          config.contracts.pregradManager.toLowerCase(),
      ),
    });
  } catch {
    return {
      kind: "failed",
      message: "The publish transaction could not be read from the chain.",
    };
  }

  const created = logs.find((log) => log.args.marketId === marketId);

  if (!created) {
    return {
      kind: "failed",
      message: "That transaction did not create the claimed market.",
    };
  }

  if (created.args.metadataHash.toLowerCase() !== metadataHash.toLowerCase()) {
    return {
      kind: "failed",
      message:
        "The published market's content is not this draft's reviewed content.",
    };
  }

  return { kind: "verified" };
}

export type MarkMarketDraftPublishedDependencies = {
  verifyReceipt: typeof verifyPublishReceipt;
};

/**
 * Records a confirmed publish transaction: verifies on-chain that the
 * transaction created the claimed market with the draft's reviewed content,
 * links the draft to it, and bridge-approves the market with the
 * review-manager key — the review already happened on the draft. The bridge
 * is best-effort — until the ADR 0022 P4 contract lands, a market is still
 * born `UnderReview`, and a failed bridge just leaves it for the market
 * review runner.
 */
export async function markMarketDraftPublished(
  {
    chainId,
    draftId,
    marketId,
    owner,
    transactionHash,
  }: {
    chainId: number;
    draftId: string;
    marketId: bigint;
    owner: string;
    transactionHash: string;
  },
  dependencies: MarkMarketDraftPublishedDependencies = {
    verifyReceipt: verifyPublishReceipt,
  },
): Promise<MarkMarketDraftPublishedResult> {
  const draft = await selectOwnedDraft(owner, draftId);

  if (!draft) {
    return { kind: "not_found" };
  }

  if (draft.status !== "approved" || !draft.submittedMetadataHash) {
    return {
      kind: "wrong_status",
      message: "Only approved drafts can be marked published.",
    };
  }

  const verification = await dependencies.verifyReceipt({
    chainId,
    metadataHash: draft.submittedMetadataHash,
    marketId,
    transactionHash,
  });

  if (verification.kind === "failed") {
    return { kind: "verification_failed", message: verification.message };
  }

  const now = new Date();
  // Conditional on the approved status observed above, so two racing publish
  // confirmations (or a concurrent edit) cannot both land.
  const [updated] = await db
    .update(schema.marketDrafts)
    .set({
      publishedAt: now,
      publishedChainId: chainId,
      publishedMarketId: marketId,
      publishedTransactionHash: transactionHash,
      status: "published",
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.marketDrafts.id, draft.id),
        eq(schema.marketDrafts.status, "approved"),
        draftVersionMatches(draft),
      ),
    )
    .returning();

  if (!updated) {
    return {
      kind: "wrong_status",
      message: "This draft just changed elsewhere — reload and try again.",
    };
  }

  const reviews = await latestReviewsFor([draft.id]);

  return {
    draft: serializeMarketDraft(updated, reviews.get(draft.id) ?? null),
    kind: "published",
  };
}

/**
 * The optimistic-version condition for guarded transitions. Compared at
 * millisecond precision on both sides: the driver round-trips timestamps as
 * JS Dates (milliseconds), while rows written by the column's defaultNow()
 * carry microseconds — a raw equality would never match those rows.
 */
function draftVersionMatches(draft: MarketDraftRow) {
  // The version token travels as an ISO string: postgres-js refuses raw
  // Date params inside sql fragments (PGlite accepts them, so tests alone
  // would not catch it).
  return sql`date_trunc('milliseconds', ${schema.marketDrafts.updatedAt}) = ${draft.updatedAt.toISOString()}::timestamp`;
}

async function selectOwnedDraft(
  owner: string,
  draftId: string,
): Promise<MarketDraftRow | null> {
  // The id comes off a URL, so it is user input: reject anything that is not a
  // well-formed public id before it reaches the query.
  if (!isDraftPublicId(draftId)) {
    return null;
  }

  const rows = await db
    .select()
    .from(schema.marketDrafts)
    .where(
      and(
        eq(schema.marketDrafts.publicId, draftId),
        eq(schema.marketDrafts.ownerUserId, owner),
        eq(schema.marketDrafts.deleted, false),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One published market's approving draft review. Deliberately not pre-keyed:
 * the market services own the `chainId:marketId` key format for their review
 * maps, and mirroring it here would be a second definition to drift.
 */
export type PublishedMarketDraftReview = {
  chainId: number;
  marketId: bigint;
  review: DraftReviewRow;
};

/**
 * Resolves published markets back to the draft review that approved them.
 *
 * This is the only review source for markets created after ADR 0022 P5 retired
 * the on-chain review path: nothing writes `market_ai_reviews` any more, so
 * without this join a published market carries no review at all.
 *
 * Only reviews of the draft's *submitted* snapshot count, and exactly one row
 * comes back per market. A draft accumulates one review row per submission,
 * and resubmitting unchanged content adds another row against the same hash,
 * so rows are narrowed to the published snapshot and reduced to the newest —
 * the last word on the content that actually shipped, never a stale verdict on
 * since-edited text. Publish enforces that this snapshot is what went on
 * chain, so the review always describes the live market's metadata.
 */
export async function latestReviewsForPublishedMarkets({
  chainIds,
  marketIds,
}: {
  chainIds: number[];
  marketIds: bigint[];
}): Promise<PublishedMarketDraftReview[]> {
  if (chainIds.length === 0 || marketIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      chainId: schema.marketDrafts.publishedChainId,
      marketId: schema.marketDrafts.publishedMarketId,
      review: schema.marketDraftReviews,
    })
    .from(schema.marketDraftReviews)
    .innerJoin(
      schema.marketDrafts,
      eq(schema.marketDrafts.id, schema.marketDraftReviews.draftId),
    )
    .where(
      and(
        inArray(schema.marketDrafts.publishedChainId, chainIds),
        inArray(schema.marketDrafts.publishedMarketId, marketIds),
        eq(
          schema.marketDraftReviews.metadataHash,
          schema.marketDrafts.submittedMetadataHash,
        ),
      ),
    )
    .orderBy(
      desc(schema.marketDraftReviews.reviewedAt),
      desc(schema.marketDraftReviews.id),
    );

  const latest = new Map<string, PublishedMarketDraftReview>();

  for (const { chainId, marketId, review } of rows) {
    // The publish columns are nullable together; the inArray filters already
    // exclude nulls, so this only narrows the types.
    if (chainId === null || marketId === null) {
      continue;
    }

    // Rows arrive newest-first, so the first sighting of a market is its
    // latest review. The key is local to this dedupe and never escapes — the
    // caller keys the results with its own review-map format.
    const key = `${chainId}:${marketId}`;

    if (!latest.has(key)) {
      latest.set(key, { chainId, marketId, review });
    }
  }

  return [...latest.values()];
}

async function latestReviewsFor(
  draftIds: number[],
): Promise<Map<number, DraftReviewRow>> {
  if (draftIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select()
    .from(schema.marketDraftReviews)
    .where(inArray(schema.marketDraftReviews.draftId, draftIds))
    .orderBy(
      desc(schema.marketDraftReviews.reviewedAt),
      desc(schema.marketDraftReviews.id),
    );
  const latest = new Map<number, DraftReviewRow>();

  for (const row of rows) {
    if (!latest.has(row.draftId)) {
      latest.set(row.draftId, row);
    }
  }

  return latest;
}

function contentColumns(patch: MarketDraftContentPatch) {
  return {
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description }
      : {}),
    ...(patch.graduationWindowSeconds !== undefined
      ? { graduationWindowSeconds: patch.graduationWindowSeconds }
      : {}),
    ...(patch.intendedCreatorAddress !== undefined
      ? {
          intendedCreatorAddress:
            patch.intendedCreatorAddress?.toLowerCase() ?? null,
        }
      : {}),
    ...(patch.isTemplate !== undefined ? { isTemplate: patch.isTemplate } : {}),
    ...(patch.liquidityParameter !== undefined
      ? { liquidityParameter: patch.liquidityParameter }
      : {}),
    ...(patch.openingProbability !== undefined
      ? { openingProbability: patch.openingProbability }
      : {}),
    ...(patch.outcomeNo !== undefined ? { outcomeNo: patch.outcomeNo } : {}),
    ...(patch.outcomeYes !== undefined ? { outcomeYes: patch.outcomeYes } : {}),
    ...(patch.question !== undefined ? { question: patch.question } : {}),
    ...(patch.resolutionCriteria !== undefined
      ? { resolutionCriteria: patch.resolutionCriteria }
      : {}),
    ...(patch.resolutionSources !== undefined
      ? { resolutionSources: patch.resolutionSources }
      : {}),
    ...(patch.resolutionUrl !== undefined
      ? { resolutionUrl: patch.resolutionUrl }
      : {}),
    ...(patch.resolutionWindowSeconds !== undefined
      ? { resolutionWindowSeconds: patch.resolutionWindowSeconds }
      : {}),
  };
}

/** True when the patch changes any hash-committed content column. */
function draftContentChanges(
  draft: MarketDraftRow,
  columns: ReturnType<typeof contentColumns>,
): boolean {
  const contentKeys = [
    "category",
    "description",
    "graduationWindowSeconds",
    "liquidityParameter",
    "openingProbability",
    "outcomeNo",
    "outcomeYes",
    "question",
    "resolutionCriteria",
    "resolutionSources",
    "resolutionUrl",
    "resolutionWindowSeconds",
  ] as const;

  return contentKeys.some(
    (key) => key in columns && columns[key] !== draft[key],
  );
}

async function draftCloneContent(
  owner: string,
  draftId: string,
): Promise<MarketDraftContentPatch | null> {
  const source = await selectOwnedDraft(owner, draftId);

  if (!source) {
    return null;
  }

  return {
    category: source.category,
    description: source.description,
    graduationWindowSeconds: source.graduationWindowSeconds,
    liquidityParameter: source.liquidityParameter,
    openingProbability: source.openingProbability,
    outcomeNo: source.outcomeNo,
    outcomeYes: source.outcomeYes,
    question: source.question,
    resolutionCriteria: source.resolutionCriteria,
    resolutionSources: source.resolutionSources,
    resolutionUrl: source.resolutionUrl,
    resolutionWindowSeconds: source.resolutionWindowSeconds,
  };
}

async function marketCloneContent(
  chainId: number,
  marketId: bigint,
): Promise<MarketDraftContentPatch | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .leftJoin(
      schema.marketMetadata,
      and(
        eq(schema.marketMetadata.chainId, schema.markets.chainId),
        eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
      ),
    )
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);
  const row = rows[0];

  if (!row) {
    return null;
  }

  const createdMs = row.market.createdBlockTimestamp.getTime();

  return {
    category: row.metadata?.category ?? "Crypto",
    description: row.metadata?.description ?? "",
    graduationWindowSeconds: windowSecondsFrom(
      createdMs,
      row.market.graduationTime,
    ),
    liquidityParameter: wadToWhole(row.market.liquidityParameter),
    openingProbability: wadToPercent(row.market.openingProbabilityWad),
    outcomeNo: row.metadata?.outcomeNo ?? "",
    outcomeYes: row.metadata?.outcomeYes ?? "",
    question: row.metadata?.question ?? "",
    resolutionCriteria: row.metadata?.resolutionCriteria ?? "",
    resolutionSources: (row.metadata?.resolutionSources ?? []).join("\n"),
    resolutionUrl: row.metadata?.resolutionUrl ?? "",
    resolutionWindowSeconds: windowSecondsFrom(
      createdMs,
      row.market.resolutionTime,
    ),
  };
}

/** The source market's actual span, floored at the submission minimum. */
function windowSecondsFrom(createdMs: number, deadline: Date): number {
  const seconds = Math.round((deadline.getTime() - createdMs) / 1000);

  return Math.max(seconds, 5 * 60);
}

function wholeToWad(value: number): bigint {
  return BigInt(Math.round(value)) * WAD;
}

function wadToWhole(value: bigint): number {
  return Number(value / WAD);
}

function wadToPercent(value: bigint): number {
  const percent = Number((value * 100n) / (WAD / 1000n)) / 1000;

  return Math.min(98, Math.max(2, Math.round(percent)));
}

/**
 * Publish deadlines anchor at chain time, not wall time: local dev jumps the
 * chain days ahead, and a wall-clock deadline computed behind chain time
 * would make createMarket revert on arrival.
 */
async function currentChainSeconds(): Promise<bigint> {
  const wallSeconds = BigInt(Math.floor(Date.now() / 1000));

  try {
    const block = await createReadOnlyClient().getBlock();

    return block.timestamp > wallSeconds ? block.timestamp : wallSeconds;
  } catch {
    return wallSeconds;
  }
}

/** Narrow a `.returning()` row that is structurally always present. */
function assertRow<T>(row: T | undefined): T {
  if (!row) {
    throw new Error("Expected a returned row.");
  }

  return row;
}
