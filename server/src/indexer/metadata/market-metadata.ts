import { keccak256, stringToBytes } from "viem";

import { db, schema } from "src/db/client";

const MAX_METADATA_BYTES = 64 * 1024;

type MarketMetadataPayload = {
  category: string;
  createdAt: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
  version: 1;
};

export async function persistMarketMetadataFromEventPayload({
  chainId,
  metadataHash,
  metadata,
}: {
  chainId: number;
  metadataHash: string;
  metadata: string;
}) {
  const payload = resolveMarketMetadataFromEventPayload({
    metadataHash,
    metadata,
  });
  const values = {
    category: payload.category,
    chainId,
    description: payload.description,
    metadataCreatedAt: payload.createdAt,
    metadataHash,
    question: payload.question,
    resolutionCriteria: payload.resolutionCriteria,
    resolutionSources: payload.resolutionSources ?? [],
    resolutionUrl: payload.resolutionUrl ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(schema.marketMetadata)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.marketMetadata.chainId,
        schema.marketMetadata.metadataHash,
      ],
      set: values,
    });
}

export function resolveMarketMetadataFromEventPayload({
  metadataHash,
  metadata,
}: {
  metadataHash: string;
  metadata: string;
}): MarketMetadataPayload {
  if (Buffer.byteLength(metadata, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("Metadata payload exceeds the indexer byte limit.");
  }

  const payload = parseMarketMetadataPayload(JSON.parse(metadata) as unknown);
  const resolvedHash = hashMarketMetadata(payload);

  if (resolvedHash.toLowerCase() !== metadataHash.toLowerCase()) {
    throw new Error(
      `Metadata hash mismatch: event=${metadataHash} payload=${resolvedHash}`,
    );
  }

  return payload;
}

function parseMarketMetadataPayload(value: unknown): MarketMetadataPayload {
  if (!isRecord(value)) {
    throw new Error("Metadata payload must be a JSON object.");
  }
  if (value.version !== 1) {
    throw new Error("Metadata version must be 1.");
  }

  const metadata: MarketMetadataPayload = {
    category: readNonEmptyString(value, "category"),
    createdAt: readNonEmptyString(value, "createdAt"),
    description: readString(value, "description"),
    question: readNonEmptyString(value, "question"),
    resolutionCriteria: readNonEmptyString(value, "resolutionCriteria"),
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

function hashMarketMetadata(metadata: MarketMetadataPayload) {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
}

function serializeMarketMetadata(metadata: MarketMetadataPayload) {
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

function readNonEmptyString(
  value: Record<string, unknown>,
  field: string,
): string {
  const fieldValue = readString(value, field);

  if (!fieldValue.trim()) {
    throw new Error(`Metadata ${field} is required.`);
  }

  return fieldValue;
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string") {
    throw new Error(`Metadata ${field} must be a string.`);
  }

  return fieldValue;
}

function readStringArray(
  value: Record<string, unknown>,
  field: string,
): string[] {
  const fieldValue = value[field];

  if (
    !Array.isArray(fieldValue) ||
    fieldValue.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Metadata ${field} must be an array of strings.`);
  }

  return fieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
