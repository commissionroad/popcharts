import { Elysia } from "elysia";

import { HealthSchema, VersionInfoSchema } from "src/api/models/system";
import { config } from "src/config";

/** Health and version probes, exposed as named OpenAPI models. */
export const systemRoutes = new Elysia({ prefix: "" })
  .model({
    Health: HealthSchema,
    VersionInfo: VersionInfoSchema,
  })
  .get(
    "/health",
    () => ({
      status: "ok",
    }),
    {
      response: {
        200: "Health",
      },
      detail: {
        operationId: "getHealth",
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
        200: "VersionInfo",
      },
      detail: {
        operationId: "getVersion",
        summary: "Get API version",
        tags: ["System"],
      },
    },
  );
