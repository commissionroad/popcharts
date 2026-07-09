import { Elysia, t } from "elysia";

import {
  PortfolioOpenOrderSchema,
  PortfolioPositionSchema,
  PortfolioReceiptSchema,
  PortfolioReceiptSettlementSchema,
  PortfolioReceiptStatusSchema,
  PortfolioSchema,
  PortfolioSummarySchema,
} from "src/api/models/portfolio";
import { getPortfolio } from "src/api/services/portfolio";

/**
 * Owner-scoped portfolio route. Every response schema is a registered model
 * referenced by name so the OpenAPI spec exposes named components and the
 * generated client gets stable model names (same convention as markets.ts).
 */
export const portfolioRoutes = new Elysia({ prefix: "" })
  .model({
    Portfolio: PortfolioSchema,
    PortfolioOpenOrder: PortfolioOpenOrderSchema,
    PortfolioPosition: PortfolioPositionSchema,
    PortfolioReceipt: PortfolioReceiptSchema,
    PortfolioReceiptSettlement: PortfolioReceiptSettlementSchema,
    PortfolioReceiptStatus: PortfolioReceiptStatusSchema,
    PortfolioSummary: PortfolioSummarySchema,
  })
  .get(
    "/portfolio/:chainId",
    async ({ params, query, set }) => {
      const result = await getPortfolio({
        chainId: Number.parseInt(params.chainId, 10),
        owner: query.owner,
      });

      if (result.kind === "invalid_owner" || result.kind === "invalid_chain") {
        set.status = 400;
        return result.message;
      }

      return result.portfolio;
    },
    {
      params: t.Object({
        chainId: t.String(),
      }),
      query: t.Object({
        owner: t.String(),
      }),
      response: {
        200: "Portfolio",
        400: t.String(),
      },
      detail: {
        operationId: "getPortfolio",
        summary: "Get a wallet's full portfolio",
        description:
          "Returns one wallet's cross-market lifecycle view: pre-graduation receipts joined to their settlement results, graduated YES/NO outcome-token positions (held wallet balance plus tokens committed to the wallet's own resting ask orders, valued at the current pool price when available), and open venue maker orders. Public owner-scoped read; no authentication.",
        tags: ["Portfolio"],
      },
    },
  );
