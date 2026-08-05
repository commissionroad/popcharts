import { Elysia, t } from "elysia";

import { resolveDraftOwner } from "src/api/draft-auth";
import { config, ZERO_ADDRESS } from "src/config";
import { reviewCreditSummary } from "src/draft-review/review-credit-meter";
import {
  DraftFeedbackFieldSchema,
  MarketDraftBondShortfallSchema,
  MarketDraftReviewCreditSchema,
  DraftFeedbackItemSchema,
  DraftFeedbackSeveritySchema,
  DraftReviewFeedbackSchema,
  MarketDraftCloneRequestSchema,
  MarketDraftListSchema,
  MarketDraftPublishedSchema,
  MarketDraftPublishedWriteSchema,
  MarketDraftPublishAuthorizationSchema,
  MarketDraftPublishParamsSchema,
  MarketDraftReviewSchema,
  MarketDraftSchema,
  MarketDraftStatusSchema,
  MarketDraftValidationErrorsSchema,
  MarketDraftWriteSchema,
} from "src/api/models/market-drafts";
import {
  buildDraftPublishParams,
  cloneMarketDraft,
  createMarketDraft,
  deleteMarketDraft,
  getMarketDraft,
  listMarketDrafts,
  markMarketDraftPublished,
  submitMarketDraft,
  updateMarketDraft,
  type CloneMarketDraftSource,
} from "src/api/services/market-drafts";

/**
 * Off-chain market draft routes (ADR 0022 P1/P2/P7): owner-scoped CRUD, the
 * submit-for-review loop, the universal clone, and the publish handshake.
 * Ownership comes from `resolveDraftOwner` — verified Privy JWTs when Privy
 * is configured, the dev header on the local network only, and a hard 501
 * anywhere else (see src/api/draft-auth.ts).
 */
export const marketDraftRoutes = new Elysia({ prefix: "" })
  .model({
    DraftFeedbackField: DraftFeedbackFieldSchema,
    DraftFeedbackItem: DraftFeedbackItemSchema,
    DraftFeedbackSeverity: DraftFeedbackSeveritySchema,
    DraftReviewFeedback: DraftReviewFeedbackSchema,
    MarketDraft: MarketDraftSchema,
    MarketDraftBondShortfall: MarketDraftBondShortfallSchema,
    MarketDraftCloneRequest: MarketDraftCloneRequestSchema,
    MarketDraftReviewCredit: MarketDraftReviewCreditSchema,
    MarketDraftList: MarketDraftListSchema,
    MarketDraftPublishAuthorization: MarketDraftPublishAuthorizationSchema,
    MarketDraftPublished: MarketDraftPublishedSchema,
    MarketDraftPublishedWrite: MarketDraftPublishedWriteSchema,
    MarketDraftPublishParams: MarketDraftPublishParamsSchema,
    MarketDraftReview: MarketDraftReviewSchema,
    MarketDraftStatus: MarketDraftStatusSchema,
    MarketDraftValidationErrors: MarketDraftValidationErrorsSchema,
    MarketDraftWrite: MarketDraftWriteSchema,
  })
  .derive(async ({ headers }) => ({
    ownerResolution: await resolveDraftOwner(headers),
  }))
  .get(
    "/drafts",
    async ({ ownerResolution, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      return listMarketDrafts({ owner: ownerResolution.owner });
    },
    {
      response: {
        200: "MarketDraftList",
        401: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "listMarketDrafts",
        summary: "List the caller's market drafts",
        description:
          "Every live (non-deleted) draft owned by the authenticated user, most recently touched first, each with its latest review.",
        tags: ["Drafts"],
      },
    },
  )
  .get(
    "/drafts/credit",
    async ({ ownerResolution, query, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      // Same wallet-identity convention as the portfolio surface: an explicit
      // lowercased address (the draft's intended creator), validated here.
      const address = query.address.toLowerCase();

      if (!/^0x[0-9a-f]{40}$/.test(address)) {
        set.status = 422;
        return "address must be a 0x-prefixed 20-byte hex address.";
      }

      if (config.contracts.reviewCreditVault === ZERO_ADDRESS) {
        return {
          availableWad: "0",
          metered: false,
          rateWad: "0",
          runsRemaining: 0,
          runsUsed: 0,
        };
      }

      const summary = await reviewCreditSummary(address);

      return {
        availableWad: summary.availableWad.toString(),
        metered: true,
        rateWad: summary.rateWad.toString(),
        runsRemaining: summary.runsRemaining,
        runsUsed: summary.runsUsed,
      };
    },
    {
      query: t.Object({ address: t.String() }),
      response: {
        200: "MarketDraftReviewCredit",
        401: t.String(),
        422: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "getMarketDraftReviewCredit",
        summary: "Read a wallet's review credit",
        description:
          "The wallet's prepaid review credit: indexed deposits minus metered charges, the per-review rate, and run counts. metered=false means no vault is configured and submission is ungated.",
        tags: ["Drafts"],
      },
    },
  )
  .post(
    "/drafts",
    async ({ body, ownerResolution, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      set.status = 201;

      return createMarketDraft({
        content: body ?? {},
        owner: ownerResolution.owner,
      });
    },
    {
      body: "MarketDraftWrite",
      response: {
        201: "MarketDraft",
        401: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "createMarketDraft",
        summary: "Create a market draft",
        description:
          "Creates a fresh editing draft (optionally a template) owned by the authenticated user.",
        tags: ["Drafts"],
      },
    },
  )
  .get(
    "/drafts/:draftId",
    async ({ ownerResolution, params, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const result = await getMarketDraft({
        draftId: Number.parseInt(params.draftId, 10),
        owner: ownerResolution.owner,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      return result.draft;
    },
    {
      params: t.Object({ draftId: t.String() }),
      response: {
        200: "MarketDraft",
        401: t.String(),
        404: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "getMarketDraft",
        summary: "Read one market draft",
        tags: ["Drafts"],
      },
    },
  )
  .patch(
    "/drafts/:draftId",
    async ({ body, ownerResolution, params, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const result = await updateMarketDraft({
        draftId: Number.parseInt(params.draftId, 10),
        owner: ownerResolution.owner,
        patch: body,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      if (result.kind === "locked") {
        set.status = 409;
        return result.message;
      }

      return result.draft;
    },
    {
      body: "MarketDraftWrite",
      params: t.Object({ draftId: t.String() }),
      response: {
        200: "MarketDraft",
        401: t.String(),
        404: t.String(),
        409: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "updateMarketDraft",
        summary: "Update a market draft",
        description:
          "Edits draft content. Any content change on a reviewed draft returns it to editing and clears its review snapshot, so stale approvals can never publish changed text.",
        tags: ["Drafts"],
      },
    },
  )
  .delete(
    "/drafts/:draftId",
    async ({ ownerResolution, params, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const result = await deleteMarketDraft({
        draftId: Number.parseInt(params.draftId, 10),
        owner: ownerResolution.owner,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      return "Deleted.";
    },
    {
      params: t.Object({ draftId: t.String() }),
      response: {
        200: t.String(),
        401: t.String(),
        404: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "deleteMarketDraft",
        summary: "Soft-delete a market draft",
        tags: ["Drafts"],
      },
    },
  )
  .post(
    "/drafts/clone",
    async ({ body, ownerResolution, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const source = cloneSource(body);

      if (!source) {
        set.status = 400;
        return "Provide fromDraftId or fromMarket.";
      }

      const result = await cloneMarketDraft({
        asTemplate: body.asTemplate ?? false,
        owner: ownerResolution.owner,
        source,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return result.message;
      }

      set.status = 201;

      return result.draft;
    },
    {
      body: "MarketDraftCloneRequest",
      response: {
        201: "MarketDraft",
        400: t.String(),
        401: t.String(),
        404: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "cloneMarketDraft",
        summary: "Clone a draft or market into a new draft",
        description:
          "The universal clone (ADR 0022): seeds a new editing draft verbatim from one of the caller's drafts or from any indexed market.",
        tags: ["Drafts"],
      },
    },
  )
  .post(
    "/drafts/:draftId/submit",
    async ({ ownerResolution, params, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const result = await submitMarketDraft({
        draftId: Number.parseInt(params.draftId, 10),
        owner: ownerResolution.owner,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      if (result.kind === "wrong_status") {
        set.status = 409;
        return result.message;
      }

      if (result.kind === "invalid") {
        set.status = 422;
        return {
          errors: result.errors as Record<string, string>,
          message: "Fix the highlighted fields before submitting.",
        };
      }

      if (result.kind === "missing_wallet") {
        set.status = 409;
        return "Connect the wallet that will publish this market before submitting.";
      }

      if (result.kind === "insufficient_bond") {
        set.status = 402;
        return {
          availableWad: result.availableWad.toString(),
          message:
            "You're out of review credit. Deposit to keep submitting — credit is spent per review and isn't refundable.",
          requiredWad: result.requiredWad.toString(),
          runsUsed: result.runsUsed,
        };
      }

      set.status = 202;

      return result.draft;
    },
    {
      params: t.Object({ draftId: t.String() }),
      response: {
        202: "MarketDraft",
        401: t.String(),
        402: "MarketDraftBondShortfall",
        404: t.String(),
        409: t.String(),
        422: "MarketDraftValidationErrors",
        501: t.String(),
      },
      detail: {
        operationId: "submitMarketDraft",
        summary: "Submit a draft for AI review",
        description:
          "Snapshots the draft content, locks it in review, and enqueues a review job. The review lands asynchronously; poll the draft until its status leaves in_review.",
        tags: ["Drafts"],
      },
    },
  )
  .post(
    "/drafts/:draftId/publish-params",
    async ({ ownerResolution, params, query, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      const result = await buildDraftPublishParams({
        creatorAddress: query.creatorAddress as `0x${string}` | undefined,
        draftId: Number.parseInt(params.draftId, 10),
        owner: ownerResolution.owner,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      if (result.kind === "wrong_status" || result.kind === "content_changed") {
        set.status = 409;
        return result.message;
      }

      return { ...result.params, authorization: result.authorization };
    },
    {
      params: t.Object({ draftId: t.String() }),
      // Wallet identity as a query param, the house pattern (orders?owner=).
      // Optional: without it the response carries no authorization, since
      // there is no wallet to bind one to.
      query: t.Object({
        creatorAddress: t.Optional(
          t.String({ pattern: "^0x[0-9a-fA-F]{40}$" }),
        ),
      }),
      response: {
        200: "MarketDraftPublishParams",
        401: t.String(),
        404: t.String(),
        409: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "buildMarketDraftPublishParams",
        summary: "Mint publish-time createMarket params for an approved draft",
        description:
          "Re-checks the draft is approved and unchanged, then resolves its relative deadline windows into absolute timestamps anchored at current chain time (ADR 0022 decision 4). The caller signs createMarket with these params plus its configured collateral.",
        tags: ["Drafts"],
      },
    },
  )
  .post(
    "/drafts/:draftId/published",
    async ({ body, ownerResolution, params, set }) => {
      if (ownerResolution.kind !== "resolved") {
        return ownerFailure(ownerResolution, set);
      }

      let marketId: bigint;

      try {
        marketId = BigInt(body.marketId);
      } catch {
        set.status = 400;
        return "Invalid market id.";
      }

      const result = await markMarketDraftPublished({
        chainId: body.chainId,
        draftId: Number.parseInt(params.draftId, 10),
        marketId,
        owner: ownerResolution.owner,
        transactionHash: body.transactionHash,
      });

      if (result.kind === "not_found") {
        set.status = 404;
        return "Draft not found.";
      }

      if (
        result.kind === "wrong_status" ||
        result.kind === "verification_failed"
      ) {
        set.status = 409;
        return result.message;
      }

      return {
        draft: result.draft,
      };
    },
    {
      body: "MarketDraftPublishedWrite",
      params: t.Object({ draftId: t.String() }),
      response: {
        200: "MarketDraftPublished",
        400: t.String(),
        401: t.String(),
        404: t.String(),
        409: t.String(),
        501: t.String(),
      },
      detail: {
        operationId: "markMarketDraftPublished",
        summary: "Record a confirmed publish transaction",
        description:
          "Links the draft to the market it became and bridge-approves the market on-chain (the review already happened on the draft).",
        tags: ["Drafts"],
      },
    },
  );

type OwnerFailure = Exclude<
  Awaited<ReturnType<typeof resolveDraftOwner>>,
  { kind: "resolved"; owner: string }
>;

function ownerFailure(
  resolution: OwnerFailure,
  set: { status?: number | string },
): string {
  set.status = resolution.kind === "unauthorized" ? 401 : 501;

  return resolution.message;
}

function cloneSource(body: {
  fromDraftId?: number;
  fromMarket?: { chainId: number; marketId: string };
}): CloneMarketDraftSource | null {
  if (body.fromDraftId !== undefined) {
    return { draftId: body.fromDraftId, kind: "draft" };
  }

  if (body.fromMarket) {
    try {
      return {
        chainId: body.fromMarket.chainId,
        kind: "market",
        marketId: BigInt(body.fromMarket.marketId),
      };
    } catch {
      return null;
    }
  }

  return null;
}
