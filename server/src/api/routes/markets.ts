import { Elysia, t } from "elysia";

import {
  CreateMarketMetadataBodySchema,
  CreateMarketMetadataResponseSchema,
  MarketCreatedEventSchema,
  MarketSchema,
  MarketMetadataResponseSchema,
} from "src/api/models/markets";
import {
  getMarketMetadata,
  saveMarketMetadata,
} from "src/api/services/metadata";
import {
  getMarketById,
  getMarketCreatedEvents,
  getMarkets,
} from "src/api/services/markets";

export const marketRoutes = new Elysia({ prefix: "" })
  .model({
    CreateMarketMetadataBody: CreateMarketMetadataBodySchema,
    CreateMarketMetadataResponse: CreateMarketMetadataResponseSchema,
    Market: MarketSchema,
    MarketCreatedEvent: MarketCreatedEventSchema,
    MarketMetadata: MarketMetadataResponseSchema,
  })
  .get(
    "/markets",
    ({ query }) =>
      getMarkets(
        query.chainId ? Number.parseInt(query.chainId, 10) : undefined,
      ),
    {
      query: t.Object({
        chainId: t.Optional(t.String()),
      }),
      response: {
        200: t.Array(MarketSchema),
      },
      detail: {
        summary: "List indexed markets",
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
  .post("/market-metadata", ({ body }) => saveMarketMetadata(body), {
    body: CreateMarketMetadataBodySchema,
    response: {
      200: CreateMarketMetadataResponseSchema,
    },
    detail: {
      summary: "Save canonical market metadata",
      tags: ["Metadata"],
    },
  })
  .get(
    "/market-metadata/:metadataHash",
    async ({ params, set }) => {
      const metadata = await getMarketMetadata(params.metadataHash);

      if (!metadata) {
        set.status = 404;
        return "Metadata not found";
      }

      return metadata;
    },
    {
      params: t.Object({
        metadataHash: t.String(),
      }),
      response: {
        200: MarketMetadataResponseSchema,
        404: t.String(),
      },
      detail: {
        summary: "Get canonical market metadata",
        tags: ["Metadata"],
      },
    },
  );
