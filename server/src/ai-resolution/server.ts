import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia, t } from "elysia";
import type { OpenAPIV3 } from "openapi-types";

import {
  AI_RESOLUTION_PROMPT_VERSION,
  aiResolutionConfig,
  type AiResolutionConfig,
} from "./config";
import { getResolutionProviderStatus } from "./providers/registry";
import { resolveMarket } from "./resolver";
import {
  RESOLUTION_MODEL_PROVIDER_NAMES,
  RESOLUTION_OUTCOMES,
  RESOLUTION_PROVIDER_NAMES,
  RESOLUTION_VERDICTS,
} from "./types";
import {
  EvidenceSchema,
  SourceCheckSchema,
} from "src/ai-review/evidence-schemas";
import { INTERNET_ACCESS_MODES } from "src/ai-review/types";
import { literalUnion } from "src/shared/typebox-literals";

const KNOWN_OUTCOME_RESOLUTION_EXAMPLE = {
  context: {
    chainId: 31337,
    creator: "0x0000000000000000000000000000000000000001",
    marketId: "1",
  },
  metadata: {
    category: "Science",
    description:
      "Resolve using public NASA announcements or major wire coverage.",
    metadataHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    question: "Did NASA announce a new Artemis launch date in 2026?",
    resolutionCriteria:
      "YES if NASA published an official new Artemis launch date before the end of 2026. [heuristic-outcome: yes]",
    resolutionUrl: "https://www.nasa.gov/",
  },
  options: {
    internetAccess: "off",
    provider: "heuristic",
  },
} as const;

const ResolutionResultSchema = t.Object({
  confidence: t.Union([t.Number(), t.Null()]),
  evidence: t.Array(EvidenceSchema),
  hardFlags: t.Array(t.String()),
  modelId: t.Optional(t.String()),
  outcome: literalUnion(RESOLUTION_OUTCOMES),
  promptVersion: t.String(),
  provider: literalUnion(RESOLUTION_PROVIDER_NAMES),
  reasons: t.Array(t.String()),
  sourceChecks: t.Array(SourceCheckSchema),
  verdict: literalUnion(RESOLUTION_VERDICTS),
});

const MarketResolutionRequestSchema = t.Object(
  {
    context: t.Optional(
      t.Object({
        chainId: t.Optional(t.Number()),
        creator: t.Optional(t.String()),
        marketId: t.Optional(t.String()),
        postgradMarketAddress: t.Optional(t.String()),
      }),
    ),
    metadata: t.Object({
      category: t.Optional(t.String()),
      description: t.Optional(t.String()),
      metadataHash: t.Optional(t.String()),
      observationWindowEnd: t.Optional(t.String()),
      observationWindowStart: t.Optional(t.String()),
      question: t.String({ minLength: 1 }),
      resolutionCriteria: t.String({ minLength: 1 }),
      resolutionSources: t.Optional(t.Array(t.String())),
      resolutionUrl: t.Optional(t.String()),
    }),
    options: t.Optional(
      t.Object({
        fetchSearchResults: t.Optional(t.Boolean()),
        internetAccess: t.Optional(literalUnion(INTERNET_ACCESS_MODES)),
        maxSearchResults: t.Optional(t.Number()),
        model: t.Optional(t.String()),
        provider: t.Optional(literalUnion(RESOLUTION_MODEL_PROVIDER_NAMES)),
      }),
    ),
  },
  { example: KNOWN_OUTCOME_RESOLUTION_EXAMPLE },
);

const MarketResolutionRequestOpenApiSchema =
  MarketResolutionRequestSchema as unknown as OpenAPIV3.SchemaObject;
const ResolutionResultOpenApiSchema =
  ResolutionResultSchema as unknown as OpenAPIV3.SchemaObject;

export const aiResolutionApp = new Elysia()
  .use(cors())
  .use(
    openapi({
      provider: "swagger-ui",
      documentation: {
        info: {
          description:
            "Local Pop Charts market AI resolution service: determines a graduated market's outcome from public evidence, with abstention and per-outcome timing gates.",
          title: "Pop Charts AI Resolution API",
          version: "0.1.0",
        },
        paths: {
          "/resolutions/market": {
            post: {
              description:
                "Determines a market's outcome (yes/no/draw/too_early/abstain) and the derived on-chain verdict.",
              requestBody: {
                content: {
                  "application/json": {
                    schema: MarketResolutionRequestOpenApiSchema,
                  },
                },
                required: true,
              },
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: ResolutionResultOpenApiSchema,
                    },
                  },
                  description: "Market resolution result",
                },
              },
              summary: "Resolve market outcome",
              tags: ["Resolutions"],
            },
          },
        },
      },
    }),
  )
  .get("/health", () => buildAiResolutionRuntimeStatus(), {
    detail: { summary: "AI resolution service health", tags: ["System"] },
  })
  .get(
    "/ready",
    ({ set }) => {
      const status = buildAiResolutionRuntimeStatus();
      if (!status.ready) {
        set.status = 503;
      }

      return status;
    },
    {
      detail: { summary: "AI resolution service readiness", tags: ["System"] },
    },
  )
  .post(
    "/resolutions/market",
    async ({ body }) =>
      resolveMarket({
        config: aiResolutionConfig,
        nowMs: Date.now(),
        request: body,
      }),
    {
      body: MarketResolutionRequestSchema,
      response: { 200: ResolutionResultSchema },
      detail: {
        description:
          "Determines a market's outcome and the derived on-chain verdict from public evidence.",
        summary: "Resolve market outcome",
        tags: ["Resolutions"],
      },
    },
  );

export function buildAiResolutionRuntimeStatus(
  config: AiResolutionConfig = aiResolutionConfig,
) {
  const activeProvider = getResolutionProviderStatus({ config });

  return {
    abstentionThreshold: config.abstentionThreshold,
    activeProvider: activeProvider.name,
    build: {
      promptVersion: AI_RESOLUTION_PROMPT_VERSION,
      version: "0.1.0",
    },
    internetAccess: config.internetAccess,
    provider: activeProvider.name,
    ready: activeProvider.available,
    status: "ok" as const,
    validation: {
      errors: activeProvider.errors,
      warnings: activeProvider.warnings,
    },
  };
}

if (import.meta.main) {
  const runtimeStatus = buildAiResolutionRuntimeStatus(aiResolutionConfig);
  if (!runtimeStatus.ready) {
    console.error(
      [
        "Pop Charts AI Resolution API is not ready for the active provider.",
        ...runtimeStatus.validation.errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
    process.exit(1);
  }

  aiResolutionApp.listen(aiResolutionConfig.port);

  console.log(
    `Pop Charts AI Resolution API running at http://localhost:${aiResolutionApp.server?.port}`,
  );
}

export type AiResolutionApp = typeof aiResolutionApp;
