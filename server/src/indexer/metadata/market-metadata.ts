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

export async function persistMarketMetadataFromUri({
  chainId,
  metadataHash,
  metadataUri,
}: {
  chainId: number;
  metadataHash: string;
  metadataUri: string;
}) {
  const metadata = await resolveMarketMetadataFromUri({
    metadataHash,
    metadataUri,
  });
  const values = {
    category: metadata.category,
    chainId,
    description: metadata.description,
    metadataCreatedAt: metadata.createdAt,
    metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    resolutionSources: metadata.resolutionSources ?? [],
    resolutionUrl: metadata.resolutionUrl ?? null,
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

export async function resolveMarketMetadataFromUri({
  metadataHash,
  metadataUri,
}: {
  metadataHash: string;
  metadataUri: string;
}): Promise<MarketMetadataPayload> {
  const text = await fetchMetadataText(metadataUri);
  const metadata = parseMarketMetadataPayload(JSON.parse(text));
  const resolvedHash = hashMarketMetadata(metadata);

  if (resolvedHash.toLowerCase() !== metadataHash.toLowerCase()) {
    throw new Error(
      `Metadata hash mismatch: event=${metadataHash} uri=${resolvedHash}`,
    );
  }

  return metadata;
}

async function fetchMetadataText(metadataUri: string): Promise<string> {
  const url = new URL(metadataUri);

  if (url.protocol === "data:") {
    return readDataUriText(metadataUri);
  }

  throw new Error(
    `Metadata URI must be a self-contained data URI; received ${url.protocol}`,
  );
}

function readDataUriText(metadataUri: string) {
  const commaIndex = metadataUri.indexOf(",");

  if (commaIndex === -1) {
    throw new Error("Metadata data URI is missing a payload.");
  }

  const metadata = metadataUri.slice(0, commaIndex);
  const payload = metadataUri.slice(commaIndex + 1);
  const isBase64 = metadata
    .split(";")
    .some((part) => part.toLowerCase() === "base64");
  const text = isBase64
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);

  if (Buffer.byteLength(text, "utf8") > MAX_METADATA_BYTES) {
    throw new Error("Metadata payload exceeds the indexer byte limit.");
  }

  return text;
}

function parseMarketMetadataPayload(value: unknown): MarketMetadataPayload {
  if (!isRecord(value)) {
    throw new Error("Metadata URI must resolve to a JSON object.");
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
