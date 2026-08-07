import { Elysia, t } from "elysia";

import { config } from "src/config";

import {
  AiReviewEvidenceSchema,
  AiReviewProviderSchema,
  AiReviewScoreRationalesSchema,
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
  ResolutionCheckAcceptedSchema,
  ResolutionCheckRefusedSchema,
  ResolutionFinalizeAcceptedSchema,
  ResolutionFinalizeRefusedSchema,
  GraduationResponseSchema,
  GraduationSummarySchema,
  MarketAiReviewSchema,
  MarketCreatedEventListSchema,
  MarketCreatedEventSchema,
  MarketListSchema,
  MarketMetadataSchema,
  MarketOrderBookSchema,
  MarketPostgradSchema,
  MarketPriceHistorySchema,
  MarketResolutionSchema,
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
  PricePointSchema,
  VenuePoolSideSchema,
} from "src/api/models/markets";
import { closePregradMarketForRefund } from "src/api/services/dev-market-close";
import {
  graduateDevMarket,
  graduateLocalMarketOnChain,
} from "src/api/services/dev-market-graduate";
import { requestMarketResolutionCheck } from "src/api/services/resolution-request";
import { resolveDevMarket } from "src/api/services/dev-market-resolve";
import { requestResolutionFinalization } from "src/api/services/resolution-finalize-request";
import { requestMarketGraduation } from "src/api/services/graduation";
import {
  getMarketById,
  getMarketCreatedEvents,
  getMarketReceiptPlacedEvents,
  getMarkets,
  parseMarketStatusFilter,
} from "src/api/services/markets";
import {
  getMarketOrderBook,
  getMarketVenueOrders,
  VENUE_ORDER_STATUS_FILTERS,
} from "src/api/services/venue-orderbook";
import { getMarketPriceHistory } from "src/api/services/price-history";
import { literalUnion } from "src/shared/typebox-literals";

/**
 * Market, graduation, and AI-review routes.
 *
 * Every response schema is a model registered below and referenced by name,
 * so the OpenAPI spec exposes named `components.schemas` entries and the
 * generated client gets stable, human-named models (see
 * `src/api/models/markets.ts` and `scripts/generate-openapi.ts`).
 */
const marketRoutesBase = new Elysia({ prefix: "" })
  .model({
    AiReviewEvidence: AiReviewEvidenceSchema,
    AiReviewProvider: AiReviewProviderSchema,
    AiReviewScoreRationales: AiReviewScoreRationalesSchema,
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
    ResolutionCheckAccepted: ResolutionCheckAcceptedSchema,
    ResolutionCheckRefused: ResolutionCheckRefusedSchema,
    ResolutionFinalizeAccepted: ResolutionFinalizeAcceptedSchema,
    ResolutionFinalizeRefused: ResolutionFinalizeRefusedSchema,
    GraduationResponse: GraduationResponseSchema,
    GraduationSummary: GraduationSummarySchema,
    Market: MarketSchema,
    MarketAiReview: MarketAiReviewSchema,
    MarketPostgrad: MarketPostgradSchema,
    MarketResolution: MarketResolutionSchema,
    MarketVenue: MarketVenueSchema,
    MarketVenuePool: MarketVenuePoolSchema,
    MarketCreatedEvent: MarketCreatedEventSchema,
    MarketCreatedEventList: MarketCreatedEventListSchema,
    MarketList: MarketListSchema,
    MarketMetadata: MarketMetadataSchema,
    MarketOrderBook: MarketOrderBookSchema,
    MarketPriceHistory: MarketPriceHistorySchema,
    MarketStatus: MarketStatusSchema,
    PricePoint: PricePointSchema,
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
      const statuses = parseMarketStatusFilter(query.status);

      if (!statuses) {
        set.status = 400;
        return "Invalid status filter";
      }

      const markets = await getMarkets({
        chainId: query.chainId ? Number.parseInt(query.chainId, 10) : undefined,
        since: query.since,
        statuses,
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
        status: t.Optional(t.String()),
      }),
      response: {
        200: "MarketList",
        400: t.String(),
      },
      detail: {
        operationId: "listMarkets",
        summary: "List indexed markets",
        description:
          "Returns up to 200 markets sorted by latest creation time. Pass an ISO `since` timestamp to fetch markets created after the previous cursor time. Pass `status` as a comma-separated list of MarketStatus values to narrow the list to those lifecycle states.",
        tags: ["Markets"],
      },
    },
  );

// Dev/admin endpoints are development-testing tools that must not exist in
// production. They are mounted only on the local network, so on any deployed
// network they are not registered at all (a 404) — not merely env-flag-gated,
// which a misconfiguration could flip on. Operator actions run locally against
// the chain, never through the deployed API (repo ADR 0009). The OpenAPI spec
// is generated under the local network, so the committed spec still describes
// them for the app's dev-tools client.
const marketRoutesWithDevTools =
  config.name === "local"
    ? marketRoutesBase
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
                "Local-network development tool: not registered on deployed networks at all. On local it additionally requires POPCHARTS_DEV_TOOLS_ENABLED=true. Fast-forwards the local chain to the market graduation deadline, calls PregradManager.markRefundable, and updates the indexed market projection.",
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
              result.kind === "invalid_market_id" ||
              result.kind === "invalid_side"
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
                "Local-network development tool: not registered on deployed networks at all. On local it additionally requires POPCHARTS_DEV_TOOLS_ENABLED=true. Calls the postgrad market resolver with side `yes` or `no`, waits for the local transaction, and updates the indexed market projection to resolved.",
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
                "Local-network development tool: not registered on deployed networks at all. On local it additionally requires POPCHARTS_DEV_TOOLS_ENABLED=true. Settles a threshold-eligible market end to end: starts onchain graduation, submits a dev clearing root, jumps the local chain past any configured challenge window, finalizes with the configured postgrad adapter, claims every receipt, and wires + seeds the postgrad venue pools. With force=true it first mints dev collateral and places receipts until the market covers its graduation threshold; without it, a below-threshold market returns 409.",
              tags: ["Development"],
            },
          },
        )
    : marketRoutesBase;

export const marketRoutes = marketRoutesWithDevTools
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
    "/markets/:chainId/:marketId/price-history",
    async ({ params, set }) => {
      const history = await getMarketPriceHistory({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      if (!history) {
        set.status = 404;
        return "Market not found";
      }

      return history;
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: "MarketPriceHistory",
        404: t.String(),
      },
      detail: {
        operationId: "getMarketPriceHistory",
        summary: "Get a market's whole-life price history",
        description:
          "Returns the market's price path across its whole trading life as fractional YES and NO cents: the virtual LMSR's implied probabilities over the receipt book (an opening point at creation, one point per receipt), then — once graduated — a synthesized handoff point where the venue pools were initialized at the pre-graduation closing price, followed by one point per indexed taker swap with the untouched outcome carried forward. The point shape is identical across the seam; graduatedAt is a chart annotation, not a phase marker on points. Histories are downsampled to a fixed ceiling, always keeping the opening and latest samples. Supersedes the venue-only read (repo ADR 0025).",
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
        status: t.Optional(literalUnion(VENUE_ORDER_STATUS_FILTERS)),
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
      const result = await requestMarketGraduation(
        {
          chainId: Number.parseInt(params.chainId, 10),
          marketId: params.marketId,
        },
        { settleGraduationOnChain: graduateLocalMarketOnChain },
      );

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
          "Public graduation failsafe for a market the keeper has not settled. For a market that reaches its threshold, the server runs the manager-keyed on-chain settlement — band-pass clearing, Merkle-root submission, finalize — and never tops up liquidity. Safe unauthenticated: eligibility is re-checked from real receipts before startGraduation and the contract enforces conservation. Below-threshold or wrong-status markets are reported (409), not touched.",
        tags: ["Graduation"],
      },
    },
  )
  .post(
    "/markets/:chainId/:marketId/resolution-check",
    async ({ params, set }) => {
      const result = await requestMarketResolutionCheck({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      switch (result.kind) {
        case "queued":
        case "already_queued":
          return { message: result.message, status: result.kind };
        case "too_early":
          set.status = 409;
          return {
            eligibleAt: result.earliestAt.toISOString(),
            message: result.message,
            status: result.kind,
          };
        case "cooling_down":
          set.status = 409;
          return {
            eligibleAt: result.nextEligibleAt.toISOString(),
            message: result.message,
            status: result.kind,
          };
        case "not_eligible":
        case "already_evaluated":
          set.status = 409;
          return { message: result.message, status: result.kind };
        case "invalid_market_id":
          set.status = 400;
          return result.message;
        case "not_found":
          set.status = 404;
          return result.message;
      }
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: "ResolutionCheckAccepted",
        400: t.String(),
        404: t.String(),
        409: "ResolutionCheckRefused",
      },
      detail: {
        operationId: "requestMarketResolutionCheck",
        summary: "Request a resolution check",
        description:
          "Public early-resolution nudge for a graduated market past its earliest resolution time — the resolution sibling of the graduation failsafe (repo ADR 0024). Queues one resolver evaluation; the AI resolver still decides the outcome and the on-chain dispute window still guards it, so the endpoint is safe unauthenticated. Cost is bounded by a per-market 24-hour cooldown rather than caller identity: repeat requests inside the window are refused (409) with the next eligible time.",
        tags: ["Resolution"],
      },
    },
  )
  .post(
    "/markets/:chainId/:marketId/resolution-finalize",
    async ({ params, set }) => {
      const result = await requestResolutionFinalization({
        chainId: Number.parseInt(params.chainId, 10),
        marketId: params.marketId,
      });

      switch (result.kind) {
        case "settled":
          return {
            message: result.message,
            status: result.kind,
            transactionHash: result.transactionHash,
          };
        case "not_graduated":
        case "no_pending_proposal":
        case "window_open":
        case "disputed":
        case "already_resolved":
          set.status = 409;
          return { message: result.message, status: result.kind };
        case "invalid_market_id":
          set.status = 400;
          return result.message;
        case "not_found":
          set.status = 404;
          return result.message;
      }
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        200: "ResolutionFinalizeAccepted",
        400: t.String(),
        404: t.String(),
        409: "ResolutionFinalizeRefused",
      },
      detail: {
        operationId: "requestResolutionFinalization",
        summary: "Settle a market whose dispute window has closed",
        description:
          "Public settlement failsafe for a proposal the keeper has not finalized — the finalize sibling of the graduation trigger and the resolution-check poke (repo ADR 0024). The keeper discovers pending proposals from the indexed market status, so a proposal the indexer missed is one nothing settles automatically: the market stays in ResolutionPending and winners cannot redeem. Safe unauthenticated and unbonded: finalizeResolution() is permissionless on the contract and takes no payment, so the server signs nothing the caller could not sign themselves, and the outcome is the one already proposed. Cost is bounded by the contract, not by caller identity — chain state is read first and no transaction is sent unless the market is genuinely settleable, so repeat requests are free reads (409).",
        tags: ["Resolution"],
      },
    },
  );
