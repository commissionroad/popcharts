import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";
import type { OpenAPIV3 } from "openapi-types";

import { aiReviewConfig } from "./config";
import { reviewMarket } from "./reviewer";

const PUBLICLY_KNOWABLE_REVIEW_EXAMPLE = {
  context: {
    chainId: 31337,
    creator: "0x0000000000000000000000000000000000000001",
    marketId: "1",
  },
  metadata: {
    category: "Science",
    createdAt: "2026-06-22T00:00:00.000Z",
    description:
      "Resolve using public NASA announcements or major wire coverage.",
    metadataHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    question: "Will NASA announce a new Artemis launch date in 2026?",
    resolutionCriteria:
      "YES if NASA publishes an official new Artemis launch date before the end of 2026. NO otherwise.",
    resolutionUrl: "https://www.nasa.gov/",
  },
  options: {
    fetchSearchResults: false,
    internetAccess: "search",
    maxSearchResults: 2,
    provider: "heuristic",
  },
} as const;

const VIOLENT_REJECT_REVIEW_EXAMPLE = {
  metadata: {
    category: "Politics",
    createdAt: "2026-06-22T00:00:00.000Z",
    description: "This should be rejected as a violent death market.",
    question:
      "Will a named public figure be assassinated before the end of 2026?",
    resolutionCriteria: "Resolve from news reports.",
  },
  options: {
    internetAccess: "off",
    provider: "heuristic",
  },
} as const;

const LOCAL_KNOWLEDGE_REJECT_REVIEW_EXAMPLE = {
  metadata: {
    category: "Culture",
    createdAt: "2026-06-22T00:00:00.000Z",
    description: "Only people in my friend group would know the answer.",
    question: "Will my two friends Alex and Sam get married this year?",
    resolutionCriteria:
      "Resolve based on whether they tell me they got married.",
  },
  options: {
    internetAccess: "off",
    provider: "heuristic",
  },
} as const;

const MARKET_REVIEW_REQUEST_EXAMPLES = {
  publicKnowable: {
    summary: "Publicly knowable market",
    value: PUBLICLY_KNOWABLE_REVIEW_EXAMPLE,
  },
  violentReject: {
    summary: "Reject: violent death market",
    value: VIOLENT_REJECT_REVIEW_EXAMPLE,
  },
  localKnowledgeReject: {
    summary: "Reject: private local knowledge",
    value: LOCAL_KNOWLEDGE_REJECT_REVIEW_EXAMPLE,
  },
} as const;

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
}, {
  example: PUBLICLY_KNOWABLE_REVIEW_EXAMPLE,
  examples: [
    PUBLICLY_KNOWABLE_REVIEW_EXAMPLE,
    VIOLENT_REJECT_REVIEW_EXAMPLE,
    LOCAL_KNOWLEDGE_REJECT_REVIEW_EXAMPLE,
  ],
});

const MarketReviewRequestOpenApiSchema =
  MarketReviewRequestSchema as unknown as OpenAPIV3.SchemaObject;
const ReviewResultOpenApiSchema =
  ReviewResultSchema as unknown as OpenAPIV3.SchemaObject;
const MarketReviewRequestOpenApiExamples =
  MARKET_REVIEW_REQUEST_EXAMPLES as unknown as Record<
    string,
    OpenAPIV3.ExampleObject | OpenAPIV3.ReferenceObject
  >;

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
        paths: {
          "/reviews/market": {
            post: {
              description:
                "Reviews market metadata for severe content-policy risk, prompt injection, and public resolvability.",
              requestBody: {
                content: {
                  "application/json": {
                    examples: MarketReviewRequestOpenApiExamples,
                    schema: MarketReviewRequestOpenApiSchema,
                  },
                },
                required: true,
              },
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: ReviewResultOpenApiSchema,
                    },
                  },
                  description: "Market review result",
                },
              },
              summary: "Review market metadata",
              tags: ["Reviews"],
            },
          },
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
