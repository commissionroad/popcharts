import { NextResponse } from "next/server";

import type { MarketMetadata } from "@/domain/market-creation/types";
import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";

type MetadataProxyRequest = {
  chainId: number;
  metadata: MarketMetadata;
  metadataHash: `0x${string}`;
};

export async function POST(request: Request) {
  const apiBaseUrl = readIndexerApiBaseUrl();

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "POPCHARTS_INDEXER_API_URL is required to sync market metadata." },
      { status: 500 }
    );
  }

  try {
    const parsed = parseRequestBody(await request.json());

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const upstream = await fetch(
      new URL(
        `markets/${parsed.value.chainId}/metadata`,
        apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`
      ),
      {
        body: JSON.stringify(toIndexerMetadataBody(parsed.value)),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
    const contentType = upstream.headers.get("content-type");
    const body = await upstream.text();
    const init: ResponseInit = contentType
      ? { headers: { "content-type": contentType }, status: upstream.status }
      : { status: upstream.status };

    return new Response(body, init);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

function toIndexerMetadataBody({ metadata, metadataHash }: MetadataProxyRequest) {
  const body = {
    category: metadata.category,
    createdAt: metadata.createdAt,
    description: metadata.description,
    metadataHash,
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
  };
  const withOutcomes = {
    ...body,
    ...(metadata.outcomeNo ? { outcomeNo: metadata.outcomeNo } : {}),
    ...(metadata.outcomeYes ? { outcomeYes: metadata.outcomeYes } : {}),
  };
  const withSources = metadata.resolutionSources?.length
    ? { ...withOutcomes, resolutionSources: metadata.resolutionSources }
    : withOutcomes;

  return metadata.resolutionUrl
    ? { ...withSources, resolutionUrl: metadata.resolutionUrl }
    : withSources;
}

function parseRequestBody(
  value: unknown
): { ok: true; value: MetadataProxyRequest } | { error: string; ok: false } {
  if (!isRecord(value)) {
    return { error: "Request body must be an object.", ok: false };
  }

  const chainId = value.chainId;

  if (!isPositiveInteger(chainId)) {
    return { error: "chainId must be a positive integer.", ok: false };
  }

  if (!isMetadataHash(value.metadataHash)) {
    return { error: "metadataHash must be a bytes32 hex string.", ok: false };
  }

  if (!isRecord(value.metadata)) {
    return { error: "metadata must be an object.", ok: false };
  }

  const metadata = value.metadata;

  if (!isVersionOne(metadata.version)) {
    return { error: "metadata.version must be 1.", ok: false };
  }

  if (!isNonEmptyString(metadata.question)) {
    return { error: "metadata.question is required.", ok: false };
  }

  if (!isString(metadata.description)) {
    return { error: "metadata.description is required.", ok: false };
  }

  if (!isString(metadata.resolutionCriteria)) {
    return { error: "metadata.resolutionCriteria is required.", ok: false };
  }

  if (!isString(metadata.createdAt)) {
    return { error: "metadata.createdAt is required.", ok: false };
  }

  if (!isMarketCategory(metadata.category)) {
    return { error: "metadata.category is not supported.", ok: false };
  }

  if (metadata.resolutionUrl !== undefined && !isString(metadata.resolutionUrl)) {
    return { error: "metadata.resolutionUrl must be a string.", ok: false };
  }

  if (metadata.outcomeYes !== undefined && !isNonEmptyString(metadata.outcomeYes)) {
    return { error: "metadata.outcomeYes must be a non-empty string.", ok: false };
  }

  if (metadata.outcomeNo !== undefined && !isNonEmptyString(metadata.outcomeNo)) {
    return { error: "metadata.outcomeNo must be a non-empty string.", ok: false };
  }

  if (
    metadata.resolutionSources !== undefined &&
    !isStringArray(metadata.resolutionSources)
  ) {
    return {
      error: "metadata.resolutionSources must be an array of strings.",
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      chainId,
      metadata: {
        category: metadata.category,
        createdAt: metadata.createdAt,
        description: metadata.description,
        ...(metadata.outcomeNo ? { outcomeNo: metadata.outcomeNo } : {}),
        ...(metadata.outcomeYes ? { outcomeYes: metadata.outcomeYes } : {}),
        question: metadata.question,
        resolutionCriteria: metadata.resolutionCriteria,
        ...(metadata.resolutionSources?.length
          ? { resolutionSources: metadata.resolutionSources }
          : {}),
        ...(metadata.resolutionUrl ? { resolutionUrl: metadata.resolutionUrl } : {}),
        version: metadata.version,
      },
      metadataHash: value.metadataHash,
    },
  };
}

function readIndexerApiBaseUrl() {
  return (
    process.env.POPCHARTS_INDEXER_API_URL ??
    process.env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isVersionOne(value: unknown): value is 1 {
  return value === 1;
}

function isMarketCategory(value: unknown): value is MarketCategory {
  return isString(value) && MARKET_CATEGORIES.includes(value as MarketCategory);
}

function isMetadataHash(value: unknown): value is `0x${string}` {
  return isString(value) && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not sync market metadata.";
}
