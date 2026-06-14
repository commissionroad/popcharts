import { getAddress, isAddress } from "viem";

import type { ProtocolCreateMarketParams } from "@/domain/market-creation/types";

export type SerializedProtocolCreateMarketParams = {
  collateral: `0x${string}`;
  graduationThreshold: string;
  graduationTime: string;
  liquidityParameter: string;
  metadataHash: `0x${string}`;
  openingProbabilityWad: string;
  resolutionTime: string;
};

export function serializeProtocolCreateMarketParams(
  params: ProtocolCreateMarketParams
): SerializedProtocolCreateMarketParams {
  return {
    collateral: params.collateral,
    graduationThreshold: params.graduationThreshold.toString(),
    graduationTime: params.graduationTime.toString(),
    liquidityParameter: params.liquidityParameter.toString(),
    metadataHash: params.metadataHash,
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
    collateral: parseAddress(value.collateral, "collateral"),
    graduationThreshold: parseBigInt(value.graduationThreshold, "graduationThreshold"),
    graduationTime: parseBigInt(value.graduationTime, "graduationTime"),
    liquidityParameter: parseBigInt(value.liquidityParameter, "liquidityParameter"),
    metadataHash: parseBytes32(value.metadataHash, "metadataHash"),
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

function parseBigInt(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${field}.`);
  }

  return BigInt(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
