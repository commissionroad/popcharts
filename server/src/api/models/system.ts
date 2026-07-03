import { t } from "elysia";
import type { Static } from "@sinclair/typebox";

/** Liveness probe response. */
export const HealthSchema = t.Object(
  {
    status: t.String(),
  },
  { $id: "Health" },
);

/** Build and deployment identity of the running API. */
export const VersionInfoSchema = t.Object(
  {
    buildTime: t.String(),
    commitSha: t.String(),
    network: t.String(),
    version: t.String(),
  },
  { $id: "VersionInfo" },
);

export type HealthResponse = Static<typeof HealthSchema>;
export type VersionInfoResponse = Static<typeof VersionInfoSchema>;
