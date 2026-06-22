import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";

import { aiReviewConfig } from "./config";
import { reviewMarket } from "./reviewer";

const ScoresSchema = t.Object({
  contentSafety: t.Number(),
  corroboration: t.Number(),
  disputeRisk: t.Number(),
  objectivity: t.Number(),
  promptInjectionRisk: t.Number(),
  publicKnowability: t.Number(),
  sourceQuality: t.Number(),
});

const SourceTierSchema = t.Union([
  t.Literal("primary"),
  t.Literal("major_news"),
  t.Literal("specialist"),
  t.Literal("ugc"),
  t.Literal("suspicious"),
  t.Literal("unreachable"),
  t.Literal("unknown"),
]);

const EvidenceSchema = t.Object({
  domain: t.String(),
  kind: t.Union([
    t.Literal("provided_url"),
    t.Literal("search_result"),
    t.Literal("fetched_page"),
  ]),
  sourceTier: SourceTierSchema,
  summary: t.String(),
  title: t.Optional(t.String()),
  url: t.String(),
});

const SourceCheckSchema = t.Object({
  domain: t.String(),
  notes: t.String(),
  relevant: t.Boolean(),
  sourceTier: SourceTierSchema,
  url: t.String(),
});

const ReviewResultSchema = t.Object({
  evidence: t.Array(EvidenceSchema),
  hardFlags: t.Array(t.String()),
  modelId: t.Optional(t.String()),
  provider: t.Union([t.Literal("heuristic"), t.Literal("ollama")]),
  promptVersion: t.String(),
  reasons: t.Array(t.String()),
  scores: ScoresSchema,
  sourceChecks: t.Array(SourceCheckSchema),
  verdict: t.Union([
    t.Literal("approve"),
    t.Literal("reject"),
    t.Literal("manual_review"),
  ]),
});

const MarketReviewRequestSchema = t.Object({
  context: t.Optional(
    t.Object({
      chainId: t.Optional(t.Number()),
      creator: t.Optional(t.String()),
      marketId: t.Optional(t.String()),
    }),
  ),
  metadata: t.Object({
    category: t.Optional(t.String()),
    createdAt: t.Optional(t.String()),
    description: t.Optional(t.String()),
    metadataHash: t.Optional(t.String()),
    question: t.String({ minLength: 1 }),
    resolutionCriteria: t.String({ minLength: 1 }),
    resolutionUrl: t.Optional(t.String()),
  }),
  options: t.Optional(
    t.Object({
      fetchSearchResults: t.Optional(t.Boolean()),
      internetAccess: t.Optional(
        t.Union([
          t.Literal("off"),
          t.Literal("provided_urls"),
          t.Literal("search"),
        ]),
      ),
      maxSearchResults: t.Optional(t.Number()),
      model: t.Optional(t.String()),
      provider: t.Optional(t.Union([t.Literal("heuristic"), t.Literal("ollama")])),
    }),
  ),
});

export const aiReviewApp = new Elysia()
  .use(cors())
  .use(
    openapi({
      documentation: {
        info: {
          description:
            "Local Pop Charts market AI review service backed by Ollama and safe web evidence collection.",
          title: "Pop Charts AI Review API",
          version: "0.1.0",
        },
      },
    }),
  )
  .get(
    "/health",
    () => ({
      internetAccess: aiReviewConfig.internetAccess,
      model: aiReviewConfig.ollamaModel,
      provider: aiReviewConfig.provider,
      status: "ok" as const,
    }),
    {
      detail: {
        summary: "AI review service health",
        tags: ["System"],
      },
    },
  )
  .post(
    "/reviews/market",
    async ({ body }) => reviewMarket({ config: aiReviewConfig, request: body }),
    {
      body: MarketReviewRequestSchema,
      response: {
        200: ReviewResultSchema,
      },
      detail: {
        description:
          "Reviews market metadata for severe content-policy risk, prompt injection, and public resolvability.",
        summary: "Review market metadata",
        tags: ["Reviews"],
      },
    },
  );

if (import.meta.main) {
  aiReviewApp.listen(aiReviewConfig.port);

  console.log(
    `Pop Charts AI Review API running at http://localhost:${aiReviewApp.server?.port}`,
  );
  console.log(
    `OpenAPI docs available at http://localhost:${aiReviewApp.server?.port}/openapi`,
  );
}

export type AiReviewApp = typeof aiReviewApp;
