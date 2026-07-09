import { Elysia, t } from "elysia";

import {
  AiReviewEvidenceSchema,
  AiReviewJobStatusSchema,
  AiReviewJobTriggerSchema,
  AiReviewProviderSchema,
  AiReviewScoresSchema,
  AiReviewSourceCheckSchema,
  AiReviewSourceTierSchema,
  AiReviewVerdictSchema,
  DevMarketCloseIneligibleSchema,
  DevMarketCloseResponseSchema,
  DevMarketGraduateIneligibleSchema,
  DevMarketGraduateResponseSchema,
  DevMarketResolveIneligibleSchema,
  DevMarketResolveResponseSchema,
  DevMarketResolveSideSchema,
  GraduationIneligibleSchema,
  GraduationResponseSchema,
  GraduationSummarySchema,
  ManualAiReviewAlreadyReviewedSchema,
  ManualAiReviewConflictSchema,
  ManualAiReviewEnqueuedSchema,
  ManualAiReviewExistingJobSchema,
  ManualAiReviewIneligibleSchema,
  ManualAiReviewRequestSchema,
  MarketAiReviewJobSchema,
  MarketAiReviewSchema,
  MarketCreatedEventListSchema,
  MarketCreatedEventSchema,
  MarketListSchema,
  MarketMetadataSchema,
  MarketMetadataWriteSchema,
  MarketOrderBookSchema,
  MarketPostgradSchema,
  MarketSchema,
  MarketStatusSchema,
  MarketVenuePoolSchema,
  MarketVenueSchema,
  ReceiptPlacedEventListSchema,
  ReceiptPlacedEventSchema,
  VenueOrderBookLevelSchema,
  VenueOrderBookPoolSchema,
  VenueOrderDirectionSchema,
  VenueOrderListSchema,
  VenueOrderSchema,
  VenueOrderStatusSchema,
  VenuePoolSideSchema,
} from "src/api/models/markets";
import { requestManualMarketReview } from "src/api/services/admin-review";
import { closePregradMarketForRefund } from "src/api/services/dev-market-close";
import { graduateDevMarket } from "src/api/services/dev-market-graduate";
import { resolveDevMarket } from "src/api/services/dev-market-resolve";
import { requestMarketGraduation } from "src/api/services/graduation";
import {
  getMarketById,
  getMarketCreatedEvents,
  getMarketReceiptPlacedEvents,
  getMarkets,
  upsertMarketMetadata,
} from "src/api/services/markets";
import {
  getMarketOrderBook,
  getMarketVenueOrders,
} from "src/api/services/venue-orderbook";

/**
 * Market, graduation, and AI-review routes.
 *
 * Every response schema is a model registered below and referenced by name,
 * so the OpenAPI spec exposes named `components.schemas` entries and the
 * generated client gets stable, human-named models (see
 * `src/api/models/markets.ts` and `scripts/generate-openapi.ts`).
 */
export const marketRoutes = new Elysia({ prefix: "" })
  .model({
    AiReviewEvidence: AiReviewEvidenceSchema,
    AiReviewJobStatus: AiReviewJobStatusSchema,
    AiReviewJobTrigger: AiReviewJobTriggerSchema,
    AiReviewProvider: AiReviewProviderSchema,
    AiReviewScores: AiReviewScoresSchema,
    AiReviewSourceCheck: AiReviewSourceCheckSchema,
    AiReviewSourceTier: AiReviewSourceTierSchema,
    AiReviewVerdict: AiReviewVerdictSchema,
    DevMarketCloseIneligible: DevMarketCloseIneligibleSchema,
    DevMarketCloseResponse: DevMarketCloseResponseSchema,
    DevMarketGraduateIneligible: DevMarketGraduateIneligibleSchema,
    DevMarketGraduateResponse: DevMarketGraduateResponseSchema,
    DevMarketResolveIneligible: DevMarketResolveIneligibleSchema,
    DevMarketResolveResponse: DevMarketResolveResponseSchema,
    DevMarketResolveSide: DevMarketResolveSideSchema,
    GraduationIneligible: GraduationIneligibleSchema,
    GraduationResponse: GraduationResponseSchema,
    GraduationSummary: GraduationSummarySchema,
    ManualAiReviewAlreadyReviewed: ManualAiReviewAlreadyReviewedSchema,
    ManualAiReviewConflict: ManualAiReviewConflictSchema,
    ManualAiReviewEnqueued: ManualAiReviewEnqueuedSchema,
    ManualAiReviewExistingJob: ManualAiReviewExistingJobSchema,
    ManualAiReviewIneligible: ManualAiReviewIneligibleSchema,
    ManualAiReviewRequest: ManualAiReviewRequestSchema,
    Market: MarketSchema,
    MarketAiReview: MarketAiReviewSchema,
    MarketPostgrad: MarketPostgradSchema,
    MarketVenue: MarketVenueSchema,
    MarketVenuePool: MarketVenuePoolSchema,
    MarketAiReviewJob: MarketAiReviewJobSchema,
    MarketCreatedEvent: MarketCreatedEventSchema,
    MarketCreatedEventList: MarketCreatedEventListSchema,
    MarketList: MarketListSchema,
    MarketMetadata: MarketMetadataSchema,
    MarketMetadataWrite: MarketMetadataWriteSchema,
    MarketOrderBook: MarketOrderBookSchema,
    MarketStatus: MarketStatusSchema,
    ReceiptPlacedEvent: ReceiptPlacedEventSchema,
    ReceiptPlacedEventList: ReceiptPlacedEventListSchema,
    VenueOrder: VenueOrderSchema,
    VenueOrderBookLevel: VenueOrderBookLevelSchema,
    VenueOrderBookPool: VenueOrderBookPoolSchema,
    VenueOrderDirection: VenueOrderDirectionSchema,
    VenueOrderList: VenueOrderListSchema,
    VenueOrderStatus: VenueOrderStatusSchema,
    VenuePoolSide: VenuePoolSideSchema,
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
        200: "MarketList",
        400: t.String(),
      },
      detail: {
        operationId: "listMarkets",
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
      body: "MarketMetadataWrite",
      params: t.Object({
        chainId: t.String(),
      }),
      response: {
        200: "MarketMetadata",
        400: t.String(),
      },
      detail: {
        operationId: "saveMarketMetadata",
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
          ...(result.marketStatus ? { marketStatus: result.marketStatus } : {}),
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
        200: "ManualAiReviewExistingJob",
        201: "ManualAiReviewEnqueued",
        400: t.String(),
        404: t.String(),
        409: "ManualAiReviewConflict",
      },
      detail: {
        operationId: "requestManualAiReview",
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
        200: "DevMarketCloseResponse",
        400: t.String(),
        404: t.String(),
        409: "DevMarketCloseIneligible",
      },
      detail: {
        operationId: "closeDevMarket",
        summary: "Dev-only close pre-grad market for refunds",
        description:
          "Development-only endpoint. Enabled only when POPCHARTS_DEV_TOOLS_ENABLED=true and NETWORK=local. Fast-forwards the local chain to the market graduation deadline, calls PregradManager.markRefundable, and updates the indexed market projection.",
        tags: ["Development"],
      },
    },
  )
  .post(
    "/dev/markets/:chainId/:marketId/resolve/:side",
    async ({ params, set }) => {
      const result = await resolveDevMarket({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
        side: params.side,
      });

      if (result.kind === "resolved") {
        return {
          market: result.market,
          status: "resolved" as const,
          ...(result.transactionHash
            ? { transactionHash: result.transactionHash }
            : {}),
          winningSide: result.winningSide,
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

      set.status =
        result.kind === "invalid_market_id" || result.kind === "invalid_side"
          ? 400
          : 404;
      return result.message;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
        side: t.String(),
      }),
      response: {
        200: "DevMarketResolveResponse",
        400: t.String(),
        404: t.String(),
        409: "DevMarketResolveIneligible",
      },
      detail: {
        operationId: "resolveDevMarket",
        summary: "Dev-only force resolve a postgrad market",
        description:
          "Development-only endpoint. Enabled only when POPCHARTS_DEV_TOOLS_ENABLED=true and NETWORK=local. Calls the postgrad market resolver with side `yes` or `no`, waits for the local transaction, and updates the indexed market projection to resolved.",
        tags: ["Development"],
      },
    },
  )
  .post(
    "/dev/markets/:chainId/:marketId/graduate",
    async ({ params, query, set }) => {
      const result = await graduateDevMarket({
        chainId: Number.parseInt(params.chainId, 10),
        force: query.force === "true",
        marketId: params.marketId,
      });

      if (result.kind === "graduated") {
        return {
          market: result.market,
          postgrad: result.postgrad,
          status: "graduated" as const,
          summary: result.summary,
          transactionHashes: result.transactionHashes,
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
      query: t.Object({
        force: t.Optional(t.String()),
      }),
      response: {
        200: "DevMarketGraduateResponse",
        400: t.String(),
        404: t.String(),
        409: "DevMarketGraduateIneligible",
      },
      detail: {
        operationId: "graduateDevMarket",
        summary: "Dev-only graduate a pre-grad market end to end",
        description:
          "Development-only endpoint. Enabled only when POPCHARTS_DEV_TOOLS_ENABLED=true and NETWORK=local. Settles a threshold-eligible market end to end: starts onchain graduation, submits a dev clearing root, jumps the local chain past any configured challenge window, finalizes with the configured postgrad adapter, claims every receipt, and wires + seeds the postgrad venue pools. With force=true it first mints dev collateral and places receipts until the market covers its graduation threshold; without it, a below-threshold market returns 409.",
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
        200: "Market",
        404: t.String(),
      },
      detail: {
        operationId: "getMarket",
        summary: "Get an indexed market",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/markets/:chainId/:marketId/orderbook",
    async ({ params, set }) => {
      const orderBook = await getMarketOrderBook({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      if (!orderBook) {
        set.status = 404;
        return "Market not found";
      }

      return orderBook;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: "MarketOrderBook",
        404: t.String(),
      },
      detail: {
        operationId: "getMarketOrderBook",
        summary: "Get a market's venue order book",
        description:
          "Returns the bounded-venue depth ladder for a graduated market's YES and NO outcome pools, aggregated from indexed open maker orders. Each level quotes the display price (WAD collateral per outcome token) at the tick-range edge nearest the current pool price and the outcome-token quantity its remaining liquidity represents. Markets without indexed venue pools return the book with both ladders omitted.",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/markets/:chainId/:marketId/orders",
    async ({ params, query, set }) => {
      const result = await getMarketVenueOrders({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
        owner: query.owner,
        status: query.status,
      });

      if (result.kind === "invalid_owner") {
        set.status = 400;
        return result.message;
      }

      if (result.kind === "unknown_market") {
        set.status = 404;
        return result.message;
      }

      return result.orders;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      query: t.Object({
        owner: t.String(),
        status: t.Optional(
          t.Union([
            t.Literal("open"),
            t.Literal("filled"),
            t.Literal("cancelled"),
            t.Literal("all"),
          ]),
        ),
      }),
      response: {
        200: "VenueOrderList",
        400: t.String(),
        404: t.String(),
      },
      detail: {
        operationId: "listMarketOrders",
        summary: "List a wallet's venue maker orders on one market",
        description:
          "Returns the indexed bounded-venue maker orders one owner placed on a market's outcome pools, newest first. Only open orders are returned unless a status filter is provided; status=all includes every lifecycle state.",
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
        200: "MarketCreatedEventList",
      },
      detail: {
        operationId: "listMarketEvents",
        summary: "Get market chain events",
        tags: ["Markets"],
      },
    },
  )
  .get(
    "/markets/:chainId/:marketId/receipts",
    ({ params }) =>
      getMarketReceiptPlacedEvents(
        Number.parseInt(params.chainId, 10),
        params.marketId,
      ),
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: "ReceiptPlacedEventList",
      },
      detail: {
        operationId: "listMarketReceipts",
        summary: "Get market receipt events",
        description:
          "Returns the indexed ReceiptPlaced events for one market ordered oldest first by on-chain sequence, so clients can replay the LMSR price history without touching an RPC provider.",
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
        200: "GraduationResponse",
        400: t.String(),
        404: t.String(),
        409: "GraduationIneligible",
      },
      detail: {
        operationId: "graduateMarket",
        summary: "Request market graduation",
        description:
          "Checks whether an indexed market is eligible for onchain graduation or already finalized. The server does not mark markets graduated; that status is indexed from PregradManager settlement events.",
        tags: ["Graduation"],
      },
    },
  );
