import { Elysia, t } from "elysia";

import { config } from "src/config";

export const systemRoutes = new Elysia({ prefix: "" })
  .get(
    "/health",
    () => ({
      status: "ok",
    }),
    {
      response: {
        200: t.Object({
          status: t.String(),
        }),
      },
      detail: {
        summary: "Health check",
        tags: ["System"],
      },
    },
  )
  .get(
    "/version",
    () => ({
      buildTime: process.env.BUILD_TIME ?? new Date().toISOString(),
      commitSha: process.env.GIT_COMMIT_SHA ?? "development",
      network: config.name,
      version: "0.1.0",
    }),
    {
      response: {
        200: t.Object({
          buildTime: t.String(),
          commitSha: t.String(),
          network: t.String(),
          version: t.String(),
        }),
      },
      detail: {
        summary: "Get API version",
        tags: ["System"],
      },
    },
  );
