import { getAddress, isAddress } from "viem";

import type { ProtocolCreateMarketParams } from "@/domain/market-creation/types";

export type SerializedProtocolCreateMarketParams = {
  bypassAiResolution: boolean;
  collateral: `0x${string}`;
  graduationDeadline: string;
  graduationThreshold: string;
  liquidityParameter: string;
  metadataHash: `0x${string}`;
  metadataURI: string;
  openingProbabilityWad: string;
  resolutionTime: string;
};

export function serializeProtocolCreateMarketParams(
  params: ProtocolCreateMarketParams
): SerializedProtocolCreateMarketParams {
  return {
    bypassAiResolution: params.bypassAiResolution,
    collateral: params.collateral,
    graduationDeadline: params.graduationDeadline.toString(),
    graduationThreshold: params.graduationThreshold.toString(),
    liquidityParameter: params.liquidityParameter.toString(),
    metadataHash: params.metadataHash,
    metadataURI: params.metadataURI,
    openingProbabilityWad: params.openingProbabilityWad.toString(),
    resolutionTime: params.resolutionTime.toString(),
  };
}

export function parseSerializedProtocolCreateMarketParams(
  value: unknown
): ProtocolCreateMarketParams {
  if (!isRecord(value)) {
    throw new Error("Expected protocolParams object.");
  }

  return {
    bypassAiResolution: parseBoolean(value.bypassAiResolution, "bypassAiResolution"),
    collateral: parseAddress(value.collateral, "collateral"),
    graduationDeadline: parseBigInt(value.graduationDeadline, "graduationDeadline"),
    graduationThreshold: parseBigInt(value.graduationThreshold, "graduationThreshold"),
    liquidityParameter: parseBigInt(value.liquidityParameter, "liquidityParameter"),
    metadataHash: parseBytes32(value.metadataHash, "metadataHash"),
    metadataURI: parseNonEmptyString(value.metadataURI, "metadataURI"),
    openingProbabilityWad: parseBigInt(
      value.openingProbabilityWad,
      "openingProbabilityWad"
    ),
    resolutionTime: parseBigInt(value.resolutionTime, "resolutionTime"),
  };
}

function parseAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${field}.`);
  }

  return getAddress(value);
}

function parseBytes32(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Invalid ${field}.`);
  }

  return value as `0x${string}`;
}

function parseNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${field}.`);
  }

  return value;
}

function parseBigInt(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${field}.`);
  }

  return BigInt(value);
}

function parseBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${field}.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
