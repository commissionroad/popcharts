import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";

import { config } from "src/config";
import { startChangeFeedRetention } from "src/live/change-feed-retention";
import { marketRoutes } from "./routes/markets";
import { portfolioRoutes } from "./routes/portfolio";
import { systemRoutes } from "./routes/system";

export const app = new Elysia()
  .use(cors())
  .use(
    openapi({
      documentation: {
        info: {
          description: "Read API for Pop Charts indexed market events.",
          title: "Pop Charts API",
          version: "0.1.0",
        },
      },
    }),
  )
  .use(systemRoutes)
  .use(marketRoutes)
  .use(portfolioRoutes);

if (import.meta.main) {
  app.listen(config.apiPort);

  console.log(`Pop Charts API running at http://localhost:${app.server?.port}`);
  console.log(
    `OpenAPI docs available at http://localhost:${app.server?.port}/openapi`,
  );

  // Age-based retention for the change-feed outbox — runs with the API, not
  // gated on SSE clients, since the indexer appends regardless (ADR 0021).
  startChangeFeedRetention({
    onError: (error) =>
      console.error("[change-feed] retention sweep failed", error),
    onPruned: (deleted) => {
      if (deleted > 0) {
        console.log(`[change-feed] pruned ${deleted} expired rows`);
      }
    },
  });
}

export type App = typeof app;
