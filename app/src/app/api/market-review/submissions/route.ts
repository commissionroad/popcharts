import { NextResponse } from "next/server";

import type { MarketMetadata } from "@/domain/market-creation/types";
import { MARKET_CATEGORIES, type MarketCategory } from "@/domain/markets/types";
import {
  parseSerializedProtocolCreateMarketParams,
  type SerializedProtocolCreateMarketParams,
} from "@/integrations/contracts/protocol-params";

type MarketReviewSubmissionRequest = {
  collateralSymbol: "pUSD";
  graduationThreshold: number;
  metadata: MarketMetadata;
  metadataHash: `0x${string}`;
  protocolParams: SerializedProtocolCreateMarketParams;
};

type MarketReviewSubmissionResponse = {
  aiReview: {
    source: "local" | "webhook";
    status: "eligible" | "forwarded";
  };
  reviewId: string;
  status: "queued";
  submittedAt: string;
};

export async function POST(request: Request) {
  try {
    const parsed = parseRequestBody(await request.json());

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const submittedAt = new Date().toISOString();
    const reviewId = createReviewId(parsed.value.metadataHash, submittedAt);
    const aiReview = await maybeForwardToReviewWebhook({
      reviewId,
      submittedAt,
      submission: parsed.value,
    });

    return NextResponse.json(
      {
        aiReview,
        reviewId,
        status: "queued",
        submittedAt,
      } satisfies MarketReviewSubmissionResponse,
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

function parseRequestBody(
  value: unknown
): { ok: true; value: MarketReviewSubmissionRequest } | { error: string; ok: false } {
  if (!isRecord(value)) {
    return { error: "Request body must be an object.", ok: false };
  }

  if (value.collateralSymbol !== "pUSD") {
    return { error: "collateralSymbol must be pUSD.", ok: false };
  }

  if (!isPositiveFiniteNumber(value.graduationThreshold)) {
    return { error: "graduationThreshold must be a positive number.", ok: false };
  }

  if (!isMetadataHash(value.metadataHash)) {
    return { error: "metadataHash must be a bytes32 hex string.", ok: false };
  }

  const protocolParams = parseProtocolParams(value.protocolParams);

  if (!protocolParams.ok) {
    return protocolParams;
  }

  const serializedProtocolParams =
    value.protocolParams as SerializedProtocolCreateMarketParams;

  if (
    protocolParams.value.metadataHash.toLowerCase() !== value.metadataHash.toLowerCase()
  ) {
    return {
      error: "metadataHash must match protocolParams.metadataHash.",
      ok: false,
    };
  }

  if (!isRecord(value.metadata)) {
    return { error: "metadata must be an object.", ok: false };
  }

  const metadata = parseMetadata(value.metadata);

  if (!metadata.ok) {
    return metadata;
  }

  return {
    ok: true,
    value: {
      collateralSymbol: value.collateralSymbol,
      graduationThreshold: value.graduationThreshold,
      metadata: metadata.value,
      metadataHash: value.metadataHash,
      protocolParams: serializedProtocolParams,
    },
  };
}

function parseProtocolParams(
  value: unknown
):
  | { ok: true; value: ReturnType<typeof parseSerializedProtocolCreateMarketParams> }
  | { error: string; ok: false } {
  try {
    return { ok: true, value: parseSerializedProtocolCreateMarketParams(value) };
  } catch (error) {
    return { error: getErrorMessage(error), ok: false };
  }
}

function parseMetadata(
  metadata: Record<string, unknown>
): { ok: true; value: MarketMetadata } | { error: string; ok: false } {
  if (metadata.version !== 1) {
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
      category: metadata.category,
      createdAt: metadata.createdAt,
      description: metadata.description,
      question: metadata.question,
      resolutionCriteria: metadata.resolutionCriteria,
      ...(metadata.resolutionSources?.length
        ? { resolutionSources: metadata.resolutionSources }
        : {}),
      ...(metadata.resolutionUrl ? { resolutionUrl: metadata.resolutionUrl } : {}),
      version: metadata.version,
    },
  };
}

async function maybeForwardToReviewWebhook({
  reviewId,
  submission,
  submittedAt,
}: {
  reviewId: string;
  submission: MarketReviewSubmissionRequest;
  submittedAt: string;
}): Promise<MarketReviewSubmissionResponse["aiReview"]> {
  const webhookUrl = readReviewWebhookUrl();

  if (!webhookUrl) {
    return {
      source: "local",
      status: "eligible",
    };
  }

  const response = await fetch(webhookUrl, {
    body: JSON.stringify({
      reviewId,
      status: "queued",
      submission,
      submittedAt,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Market review webhook failed with ${response.status}.`);
  }

  return {
    source: "webhook",
    status: "forwarded",
  };
}

function readReviewWebhookUrl() {
  const value = process.env.POPCHARTS_MARKET_REVIEW_WEBHOOK_URL;

  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol.");
    }

    return url;
  } catch {
    throw new Error("POPCHARTS_MARKET_REVIEW_WEBHOOK_URL must be an HTTP URL.");
  }
}

function createReviewId(metadataHash: `0x${string}`, submittedAt: string) {
  return `review-${metadataHash.slice(2, 10)}-${Date.parse(submittedAt).toString(36)}`;
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

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isMarketCategory(value: unknown): value is MarketCategory {
  return isString(value) && MARKET_CATEGORIES.includes(value as MarketCategory);
}

function isMetadataHash(value: unknown): value is `0x${string}` {
  return isString(value) && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not submit market for review.";
}
