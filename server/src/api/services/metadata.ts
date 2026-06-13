import { keccak256, stringToBytes } from "viem";

import type {
  CreateMarketMetadataResponse,
  MarketCategory,
  MarketMetadataResponse,
} from "src/api/models/markets";
import { db, eq, schema } from "src/db/client";

export type MarketMetadataInput = {
  category: MarketCategory;
  createdAt?: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
  version?: 1;
};

export type StoredMarketMetadata = {
  category: MarketCategory;
  createdAt: string;
  description: string;
  metadataHash: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
  version: 1;
};

export async function saveMarketMetadata(
  input: MarketMetadataInput,
): Promise<CreateMarketMetadataResponse> {
  const metadata = canonicalizeMarketMetadata(input);
  const serialized = serializeMarketMetadata(metadata);
  const metadataHash = keccak256(stringToBytes(serialized));
  const now = new Date();

  await db
    .insert(schema.marketMetadata)
    .values({
      category: metadata.category,
      createdAt: new Date(metadata.createdAt),
      description: metadata.description,
      metadataHash,
      metadataJson: JSON.parse(serialized) as Record<string, unknown>,
      question: metadata.question,
      resolutionCriteria: metadata.resolutionCriteria,
      resolutionUrl: metadata.resolutionUrl,
      updatedAt: now,
      version: metadata.version,
    })
    .onConflictDoUpdate({
      target: schema.marketMetadata.metadataHash,
      set: {
        category: metadata.category,
        description: metadata.description,
        metadataJson: JSON.parse(serialized) as Record<string, unknown>,
        question: metadata.question,
        resolutionCriteria: metadata.resolutionCriteria,
        resolutionUrl: metadata.resolutionUrl,
        updatedAt: now,
      },
    });

  return {
    metadata: {
      ...metadata,
      metadataHash,
    },
    metadataHash,
  };
}

export async function getMarketMetadata(
  metadataHash: string,
): Promise<MarketMetadataResponse | null> {
  const row = await db.query.marketMetadata.findFirst({
    where: eq(schema.marketMetadata.metadataHash, metadataHash),
  });

  return row ? serializeMetadataRow(row) : null;
}

export function canonicalizeMarketMetadata(
  input: MarketMetadataInput,
): Omit<StoredMarketMetadata, "metadataHash"> {
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date();

  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("Invalid metadata createdAt timestamp.");
  }

  const base = {
    category: input.category,
    createdAt: createdAt.toISOString(),
    description: input.description.trim(),
    question: input.question.trim(),
    resolutionCriteria: input.resolutionCriteria.trim(),
    version: 1 as const,
  };
  const resolutionUrl = input.resolutionUrl?.trim();

  if (!resolutionUrl) {
    return base;
  }

  return {
    ...base,
    resolutionUrl,
  };
}

export function serializeMarketMetadata(
  metadata: Omit<StoredMarketMetadata, "metadataHash">,
) {
  const ordered: Record<string, string | number> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

function serializeMetadataRow(
  row: typeof schema.marketMetadata.$inferSelect,
): MarketMetadataResponse {
  return {
    category: row.category as MarketCategory,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    metadataHash: row.metadataHash,
    question: row.question,
    resolutionCriteria: row.resolutionCriteria,
    resolutionUrl: row.resolutionUrl ?? undefined,
    version: 1,
  };
}
