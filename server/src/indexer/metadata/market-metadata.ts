import { serializeMarketMetadata } from "@popcharts/protocol";
import type { MarketMetadata } from "@popcharts/protocol";
import { keccak256, stringToBytes } from "viem";

import { db, schema } from "src/db/client";
import { MARKET_METADATA_CATEGORY_MAX_CHARS } from "src/db/schema/market-metadata";
import { ParkSweepError } from "src/indexer/utils/park-sweep-error";

const MAX_METADATA_BYTES = 64 * 1024;

/**
 * The indexer's name for the protocol metadata schema. Aliased rather than
 * restated so the verifier can never accept a shape the creators cannot
 * produce.
 */
export type MarketMetadataPayload = MarketMetadata;

export { serializeMarketMetadata };

/**
 * The metadata store rejected a payload the parser had already admitted.
 * {@link parseMarketMetadataPayload} enforces every bound the table does, so
 * what can still fail at the insert is the database itself — transient by
 * elimination, and parkable: the sweep holds the manager's address below the
 * log and retries, instead of checkpointing past a market whose display text
 * never landed. The event path is the only metadata writer (ADR 0022 P6), so
 * a swallowed failure here would be permanent.
 */
export class MarketMetadataWriteError extends ParkSweepError {}

/**
 * Persists the metadata a MarketCreated event carries, classifying failure by
 * what a retry could change: a payload that fails the parse or the hash check
 * fails identically forever, so it is logged and skipped (the market row
 * stands; only its display text is missing); a database failure raises
 * {@link MarketMetadataWriteError} so the sweep parks and retries. The upsert
 * is content-addressed and idempotent — callers run it on every delivery,
 * replays included, which is what heals a row an earlier pass failed to
 * write.
 */
export async function persistMarketMetadataFromEventPayload(
  {
    chainId,
    marketId,
    metadataHash,
    metadata,
  }: {
    chainId: number;
    marketId: bigint;
    metadataHash: string;
    metadata: string | null | undefined;
  },
  dbc: typeof db = db,
) {
  let payload: MarketMetadataPayload;

  try {
    if (!metadata) {
      throw new Error("MarketCreated records are missing metadata.");
    }

    payload = resolveMarketMetadataFromEventPayload({
      metadataHash,
      metadata,
    });
  } catch (error) {
    console.warn(
      `[MarketCreated] metadata unavailable marketId=${marketId.toString()}: ${getErrorMessage(error)}`,
    );
    return;
  }

  const values = {
    category: payload.category,
    chainId,
    description: payload.description,
    metadataCreatedAt: payload.createdAt,
    metadataHash,
    outcomeNo: payload.outcomeNo ?? null,
    outcomeYes: payload.outcomeYes ?? null,
    question: payload.question,
    resolutionCriteria: payload.resolutionCriteria,
    resolutionSources: payload.resolutionSources ?? [],
    resolutionUrl: payload.resolutionUrl ?? null,
    updatedAt: new Date(),
  };

  try {
    await dbc
      .insert(schema.marketMetadata)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.marketMetadata.chainId,
          schema.marketMetadata.metadataHash,
        ],
        set: values,
      });
  } catch (error) {
    throw new MarketMetadataWriteError(
      `market metadata write failed marketId=${marketId.toString()}: ${getErrorMessage(error)}`,
    );
  }
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

// Deliberately stricter than the protocol's `parseMarketMetadata`: the indexer
// rejects blank required fields that the shared parser accepts as valid
// strings, because a market row with an empty question is unusable downstream.
// Admission policy is the indexer's to set; only the byte layout is shared.
//
// It also enforces every bound the market_metadata table does (today: the
// category varchar and the total byte cap), so a payload this parser admits
// always inserts — which is what entitles the persist step to treat any
// insert failure as transient and parkable rather than a poison log.
function parseMarketMetadataPayload(value: unknown): MarketMetadataPayload {
  if (!isRecord(value)) {
    throw new Error("Metadata payload must be a JSON object.");
  }
  if (value.version !== 1) {
    throw new Error("Metadata version must be 1.");
  }

  const category = readNonEmptyString(value, "category");

  if (category.length > MARKET_METADATA_CATEGORY_MAX_CHARS) {
    throw new Error(
      `Metadata category exceeds ${MARKET_METADATA_CATEGORY_MAX_CHARS} characters.`,
    );
  }

  const metadata: MarketMetadataPayload = {
    category,
    createdAt: readNonEmptyString(value, "createdAt"),
    description: readString(value, "description"),
    question: readNonEmptyString(value, "question"),
    resolutionCriteria: readNonEmptyString(value, "resolutionCriteria"),
    version: 1,
  };

  if (value.outcomeYes !== undefined) {
    metadata.outcomeYes = readNonEmptyString(value, "outcomeYes");
  }
  if (value.outcomeNo !== undefined) {
    metadata.outcomeNo = readNonEmptyString(value, "outcomeNo");
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
 * Recomputes the metadata commitment from the canonical serialization. This is
 * the check that catches a creator whose bytes disagree with the protocol's.
 */
export function hashMarketMetadata(metadata: MarketMetadataPayload) {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
