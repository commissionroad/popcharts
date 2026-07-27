/**
 * Canonical market metadata schema: the accepted fields and the exact byte
 * layout that every market creator serializes and the indexer re-hashes to
 * verify. This module is deliberately dependency-free so runtimes that cannot
 * resolve TypeScript from `node_modules` (the root `scripts/` tree, which runs
 * under `node --experimental-strip-types`) can import it by relative path
 * instead of mirroring the schema.
 */

/**
 * A market's off-chain metadata payload. Optional fields are omitted from the
 * serialized form entirely rather than emitted as null, because their presence
 * changes the hashed bytes.
 */
export type MarketMetadata = {
  category: string;
  createdAt: string;
  description: string;
  outcomeNo?: string;
  outcomeYes?: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
  version: 1;
};

/**
 * Validates an untrusted value (env var, JSON from disk, on-chain event
 * payload) as market metadata, throwing an actionable error on the first bad
 * field. Callers downstream of this receive trusted, typed metadata.
 */
export function parseMarketMetadata(value: unknown): MarketMetadata {
  if (!isRecord(value)) {
    throw new Error("Market metadata must be a JSON object.");
  }

  if (value.version !== 1) {
    throw new Error("Market metadata version must be 1.");
  }

  const metadata: MarketMetadata = {
    category: readString(value, "category"),
    createdAt: readString(value, "createdAt"),
    description: readString(value, "description"),
    question: readString(value, "question"),
    resolutionCriteria: readString(value, "resolutionCriteria"),
    version: 1,
  };

  if (value.outcomeYes !== undefined) {
    metadata.outcomeYes = readString(value, "outcomeYes");
  }
  if (value.outcomeNo !== undefined) {
    metadata.outcomeNo = readString(value, "outcomeNo");
  }
  if (value.resolutionUrl !== undefined) {
    metadata.resolutionUrl = readString(value, "resolutionUrl");
  }
  if (value.resolutionSources !== undefined) {
    metadata.resolutionSources = readStringArray(value, "resolutionSources");
  }

  return metadata;
}

/**
 * Renders metadata to its canonical JSON string. Key order is part of the hash
 * commitment — the indexer recomputes the metadata hash from exactly these
 * bytes — so every creator must serialize through this function and never a
 * reimplementation.
 */
export function serializeMarketMetadata(metadata: MarketMetadata): string {
  const ordered: Record<string, string | number | string[]> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.outcomeYes) {
    ordered.outcomeYes = metadata.outcomeYes;
  }
  if (metadata.outcomeNo) {
    ordered.outcomeNo = metadata.outcomeNo;
  }
  if (metadata.resolutionSources?.length) {
    ordered.resolutionSources = metadata.resolutionSources;
  }
  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string") {
    throw new Error(`Market metadata ${field} must be a string.`);
  }

  return fieldValue;
}

function readStringArray(value: Record<string, unknown>, field: string): string[] {
  const fieldValue = value[field];

  if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== "string")) {
    throw new Error(`Market metadata ${field} must be an array of strings.`);
  }

  return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
