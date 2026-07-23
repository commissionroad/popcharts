import { t } from "elysia";

import { EVIDENCE_KINDS, SOURCE_TIERS } from "./types";
import { literalUnion } from "src/shared/typebox-literals";

/**
 * Request/response validation schemas for the evidence trail, shared by the
 * AI review and AI resolution services. The resolution service reuses these
 * shapes verbatim by design (`docs/ai-resolution-service-design.md`) — only
 * the verdict semantics differ — so they get one definition here rather than
 * a copy in each service's `server.ts`.
 */

/** Trust classification of an evidence source, from best to worst. */
const SourceTierSchema = literalUnion(SOURCE_TIERS);

/** One retrieved (or unreachable) public source recorded against a judgment. */
export const EvidenceSchema = t.Object({
  domain: t.String(),
  kind: literalUnion(EVIDENCE_KINDS),
  sourceTier: SourceTierSchema,
  summary: t.String(),
  title: t.Optional(t.String()),
  url: t.String(),
});

/** A judgment about one cited source URL. */
export const SourceCheckSchema = t.Object({
  domain: t.String(),
  notes: t.String(),
  relevant: t.Boolean(),
  sourceTier: SourceTierSchema,
  url: t.String(),
});
