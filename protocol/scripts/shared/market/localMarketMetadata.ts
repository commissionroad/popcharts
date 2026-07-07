import { keccak256, stringToBytes } from "viem";

/**
 * Market metadata payload shared between the root local-create-market wrapper
 * (which passes it through the LOCAL_MARKET_METADATA env var) and the protocol
 * helper that stores it onchain. Parsing and serialization live here so the
 * accepted schema and the hashed byte layout stay in one place.
 */
export type MarketMetadata = {
  category: string;
  createdAt: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
  version: 1;
};

export function buildLocalSmokeMarketMetadata(): MarketMetadata {
  const createdAt = new Date().toISOString();

  return {
    category: "Crypto",
    createdAt,
    description: "Local smoke market created by the direct protocol helper for indexer recovery.",
    question: `Will the local Pop Charts smoke market created at ${createdAt} be indexed?`,
    resolutionCriteria:
      "Resolves YES if the local development indexer records this direct contract-created market.",
    resolutionSources: ["Local Hardhat chain", "Pop Charts local indexer"],
    version: 1,
  };
}

export function hashMarketMetadata(metadata: MarketMetadata): `0x${string}` {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
}

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

  if (value.resolutionUrl !== undefined) {
    metadata.resolutionUrl = readString(value, "resolutionUrl");
  }
  if (value.resolutionSources !== undefined) {
    metadata.resolutionSources = readStringArray(value, "resolutionSources");
  }

  return metadata;
}

export function serializeMarketMetadata(metadata: MarketMetadata): string {
  // Key order is stable so the serialized metadata (and therefore its hash)
  // is reproducible for the same payload.
  const ordered: Record<string, string | number | string[]> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

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
