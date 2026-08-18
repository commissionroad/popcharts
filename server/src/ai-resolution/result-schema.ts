import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";

import {
  EvidenceSchema,
  SourceCheckSchema,
} from "src/ai-review/evidence-schemas";
import { literalUnion } from "src/shared/typebox-literals";

import {
  RESOLUTION_OUTCOMES,
  RESOLUTION_PROVIDER_NAMES,
  RESOLUTION_VERDICTS,
  type ResolutionResult,
} from "./types";

/**
 * The wire contract for a completed resolution. The service declares its 200
 * response with this schema, and the runner validates against the same object
 * before it trusts a response — one definition on both sides of the HTTP hop,
 * so a client-side copy cannot drift from what the service actually promises.
 */
export const ResolutionResultSchema = t.Object({
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

/** Raised when a response body does not match {@link ResolutionResultSchema}. */
export class ResolutionResultSchemaError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `AI Resolution service returned a malformed result: ${problems.join("; ")}.`,
    );
    this.name = "ResolutionResultSchemaError";
  }
}

/** How many schema errors to name before truncating a very wrong body. */
const MAX_REPORTED_PROBLEMS = 5;

/**
 * Validates an untrusted response body and returns it as a
 * {@link ResolutionResult}, throwing {@link ResolutionResultSchemaError} when
 * it does not conform.
 *
 * This is what a TypeScript `as ResolutionResult` cast does not do: the cast is
 * erased at compile time, so any JSON at all — a truncated body, an error page,
 * a different service answering the port — reaches the verdict switch shaped
 * like a resolution.
 *
 * The cast after `Value.Check` is safe and narrow: the check has already proven
 * the value matches the schema. `result-schema.test.ts` asserts a complete
 * ResolutionResult satisfies the schema, so the two cannot drift silently.
 */
export function parseResolutionResult(value: unknown): ResolutionResult {
  if (Value.Check(ResolutionResultSchema, value)) {
    return value as ResolutionResult;
  }

  const problems = [...Value.Errors(ResolutionResultSchema, value)]
    .slice(0, MAX_REPORTED_PROBLEMS)
    .map((error) => `${error.path || "/"} ${error.message}`);

  throw new ResolutionResultSchemaError(
    problems.length > 0 ? problems : ["body is not an object"],
  );
}
