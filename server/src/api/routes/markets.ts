import { Elysia, t } from "elysia";

import {
  DevMarketCloseIneligibleSchema,
  DevMarketCloseResponseSchema,
  GraduationIneligibleSchema,
  GraduationResponseSchema,
  MarketAiReviewSchema,
  ManualAiReviewAlreadyReviewedSchema,
  ManualAiReviewEnqueuedSchema,
  ManualAiReviewExistingJobSchema,
  ManualAiReviewIneligibleSchema,
  ManualAiReviewRequestSchema,
  MarketAiReviewJobSchema,
  MarketMetadataSchema,
  MarketMetadataWriteSchema,
  MarketCreatedEventSchema,
  MarketSchema,
} from "src/api/models/markets";
import { requestManualMarketReview } from "src/api/services/admin-review";
import { closePregradMarketForRefund } from "src/api/services/dev-market-close";
import { requestMarketGraduation } from "src/api/services/graduation";
import {
  getMarketById,
  getMarketCreatedEvents,
  getMarkets,
  upsertMarketMetadata,
} from "src/api/services/markets";

export const marketRoutes = new Elysia({ prefix: "" })
  .model({
    DevMarketCloseIneligible: DevMarketCloseIneligibleSchema,
    DevMarketCloseResponse: DevMarketCloseResponseSchema,
    GraduationIneligible: GraduationIneligibleSchema,
    GraduationResponse: GraduationResponseSchema,
    Market: MarketSchema,
    MarketAiReview: MarketAiReviewSchema,
    MarketAiReviewJob: MarketAiReviewJobSchema,
    ManualAiReviewAlreadyReviewed: ManualAiReviewAlreadyReviewedSchema,
    ManualAiReviewEnqueued: ManualAiReviewEnqueuedSchema,
    ManualAiReviewExistingJob: ManualAiReviewExistingJobSchema,
    ManualAiReviewIneligible: ManualAiReviewIneligibleSchema,
    ManualAiReviewRequest: ManualAiReviewRequestSchema,
    MarketCreatedEvent: MarketCreatedEventSchema,
    MarketMetadata: MarketMetadataSchema,
    MarketMetadataWrite: MarketMetadataWriteSchema,
  })
  .get(
    "/markets",
    async ({ query, set }) => {
      const markets = await getMarkets({
        chainId: query.chainId ? Number.parseInt(query.chainId, 10) : undefined,
        since: query.since,
      });

      if (!markets) {
        set.status = 400;
        return "Invalid since timestamp";
      }

      return markets;
    },
    {
      query: t.Object({
        chainId: t.Optional(t.String()),
        since: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(MarketSchema),
        400: t.String(),
      },
      detail: {
        summary: "List indexed markets",
        description:
          "Returns up to 200 markets sorted by latest creation time. Pass an ISO `since` timestamp to fetch markets created after the previous cursor time.",
        tags: ["Markets"],
      },
    },
  )
  .post(
    "/markets/:chainId/metadata",
    async ({ body, params, set }) => {
      const metadata = await upsertMarketMetadata(
        Number.parseInt(params.chainId, 10),
        body,
      );

      if (!metadata) {
        set.status = 400;
        return "Invalid chain id";
      }

      return metadata;
    },
    {
      body: MarketMetadataWriteSchema,
      params: t.Object({
        chainId: t.String(),
      }),
      response: {
        200: MarketMetadataSchema,
        400: t.String(),
      },
      detail: {
        summary: "Save off-chain market metadata",
        description:
          "Stores human-readable market metadata by chain ID and metadata hash so indexed markets can render their question and resolution context.",
        tags: ["Markets"],
      },
    },
  )
  .post(
    "/admin/markets/:chainId/:marketId/review",
    async ({ body, params, set }) => {
      const result = await requestManualMarketReview({
        body: body ?? undefined,
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      if (result.kind === "enqueued") {
        set.status = 201;
        return {
          job: result.job,
          status: "enqueued" as const,
        };
      }

      if (result.kind === "existing_active_job") {
        return {
          job: result.job,
          message: result.message,
          status: "already_queued" as const,
        };
      }

      if (result.kind === "already_reviewed") {
        set.status = 409;
        return {
          aiReview: result.aiReview,
          message: result.message,
          status: "already_reviewed" as const,
        };
      }

      if (result.kind === "ineligible") {
        set.status = 409;
        return {
          ...(result.marketStatus
            ? { marketStatus: result.marketStatus }
            : {}),
          message: result.message,
          reason: result.reason,
          status: "ineligible" as const,
        };
      }

      if (result.kind === "admin_disabled") {
        set.status = 404;
        return "Not found";
      }

      set.status = result.kind === "invalid_market_id" ? 400 : 404;
      return result.message;
    },
    {
      body: t.Optional(ManualAiReviewRequestSchema),
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: ManualAiReviewExistingJobSchema,
        201: ManualAiReviewEnqueuedSchema,
        400: t.String(),
        404: t.String(),
        409: t.Union([
          ManualAiReviewAlreadyReviewedSchema,
          ManualAiReviewIneligibleSchema,
        ]),
      },
      detail: {
        summary: "Admin-only enqueue market AI review",
        description:
          "Disabled unless POPCHARTS_ADMIN_REVIEW_ENABLED=true. Enqueues manual AI review work for the runner; it does not call the AI Review service directly.",
        tags: ["Administration"],
      },
    },
  )
  .post(
    "/dev/markets/:chainId/:marketId/close",
    async ({ params, set }) => {
      const result = await closePregradMarketForRefund({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      if (result.kind === "closed") {
        return {
          market: result.market,
          refundAvailable: result.refundAvailable,
          status: "refunded" as const,
          ...(result.transactionHash
            ? { transactionHash: result.transactionHash }
            : {}),
        };
      }

      if (result.kind === "ineligible") {
        set.status = 409;
        return {
          market: result.market,
          message: result.message,
          reason: result.reason,
          status: "ineligible" as const,
        };
      }

      if (result.kind === "dev_disabled") {
        set.status = 404;
        return "Not found";
      }

      set.status = result.kind === "invalid_market_id" ? 400 : 404;
      return result.message;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: DevMarketCloseResponseSchema,
        400: t.String(),
        404: t.String(),
        409: DevMarketCloseIneligibleSchema,
      },
      detail: {
        summary: "Dev-only close pre-grad market for refunds",
        description:
          "Development-only endpoint. Enabled only when POPCHARTS_DEV_TOOLS_ENABLED=true and NETWORK=local. Fast-forwards the local chain to the market graduation deadline, calls PregradManager.markRefundable, and updates the indexed market projection.",
        tags: ["Development"],
      },
    },
  )
  .get(
    "/markets/:chainId/:marketId",
    async ({ params, set }) => {
      const market = await getMarketById(
        Number.parseInt(params.chainId, 10),
        params.marketId,
      );

      if (!market) {
        set.status = 404;
        return "Market not found";
      }

      return market;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: MarketSchema,
        404: t.String(),
      },
      detail: {
        summary: "Get an indexed market",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/markets/:chainId/:marketId/events",
    ({ params }) =>
      getMarketCreatedEvents(
        Number.parseInt(params.chainId, 10),
        params.marketId,
      ),
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: t.Array(MarketCreatedEventSchema),
      },
      detail: {
        summary: "Get market chain events",
        tags: ["Markets"],
      },
    },
  )
  .post(
    "/markets/:chainId/:marketId/graduate",
    async ({ params, set }) => {
      const result = await requestMarketGraduation({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      if (result.kind === "graduated") {
        return {
          market: result.market,
          status: "graduated" as const,
          summary: result.summary,
        };
      }

      if (result.kind === "ineligible") {
        set.status = 409;
        return {
          market: result.market,
          message: result.message,
          reason: result.reason,
          status: "ineligible" as const,
          summary: result.summary,
        };
      }

      set.status = result.kind === "invalid_market_id" ? 400 : 404;
      return result.message;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: GraduationResponseSchema,
        400: t.String(),
        404: t.String(),
        409: GraduationIneligibleSchema,
      },
      detail: {
        summary: "Request market graduation",
        description:
          "Checks whether an indexed market is eligible for onchain graduation or already finalized. The server does not mark markets graduated; that status is indexed from PregradManager settlement events.",
        tags: ["Graduation"],
      },
    },
  );
