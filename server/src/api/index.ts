import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";

import { config } from "src/config";
import { marketRoutes } from "./routes/markets";
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
  .use(marketRoutes);

if (import.meta.main) {
  app.listen(config.apiPort);

  console.log(`Pop Charts API running at http://localhost:${app.server?.port}`);
  console.log(
    `OpenAPI docs available at http://localhost:${app.server?.port}/openapi`,
  );
}

export type App = typeof app;
