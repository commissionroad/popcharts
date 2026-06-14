import { Elysia, t } from "elysia";

import {
  GraduationRequestStubSchema,
  MarketMetadataSchema,
  MarketMetadataWriteSchema,
  MarketCreatedEventSchema,
  MarketSchema,
} from "src/api/models/markets";
import {
  getMarketById,
  getMarketCreatedEvents,
  getMarkets,
  upsertMarketMetadata,
} from "src/api/services/markets";

export const marketRoutes = new Elysia({ prefix: "" })
  .model({
    GraduationRequestStub: GraduationRequestStubSchema,
    Market: MarketSchema,
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
    ({ set }) => {
      set.status = 501;
      return {
        message:
          "Graduation requests are not implemented yet. A future server flow will check eligibility and submit graduation.",
        status: "not_implemented" as const,
      };
    },
    {
      params: t.Object({
        chainId: t.String(),
        marketId: t.String(),
      }),
      response: {
        501: GraduationRequestStubSchema,
      },
      detail: {
        summary: "Request market graduation",
        description:
          "Stubbed endpoint for the future server-mediated graduation flow.",
        tags: ["Graduation"],
      },
    },
  );
