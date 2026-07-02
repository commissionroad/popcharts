import { describe, expect, it } from "bun:test";
import { keccak256, stringToBytes } from "viem";

import { resolveMarketMetadataFromEventPayload } from "./market-metadata";

const metadata = {
  category: "Crypto",
  createdAt: "2026-07-02T12:00:00.000Z",
  description: "Resolve using public local smoke evidence.",
  question: "Will direct market creation carry metadata?",
  resolutionCriteria:
    "YES if the indexer can recover metadata from the creation event payload.",
  resolutionSources: ["CNN", "NPR", "https://www.bbc.com/news"],
  version: 1 as const,
};

describe("resolveMarketMetadataFromEventPayload", () => {
  it("parses canonical JSON metadata from the creation event payload", () => {
    const resolved = resolveMarketMetadataFromEventPayload({
      metadataHash: hashMetadata(metadata),
      metadata: serializeMetadata(metadata),
    });

    expect(resolved).toEqual(metadata);
  });

  it("rejects metadata whose canonical payload does not match the event hash", () => {
    expect(() =>
      resolveMarketMetadataFromEventPayload({
        metadataHash: `0x${"f".repeat(64)}`,
        metadata: serializeMetadata(metadata),
      }),
    ).toThrow("Metadata hash mismatch");
  });

  it("rejects metadata payloads that are not JSON objects", () => {
    expect(() =>
      resolveMarketMetadataFromEventPayload({
        metadataHash: hashMetadata(metadata),
        metadata: '"not an object"',
      }),
    ).toThrow("Metadata payload must be a JSON object.");
  });
});

function hashMetadata(value: typeof metadata) {
  return keccak256(stringToBytes(serializeMetadata(value)));
}

function serializeMetadata(value: typeof metadata) {
  return JSON.stringify({
    version: value.version,
    question: value.question,
    description: value.description,
    category: value.category,
    resolutionCriteria: value.resolutionCriteria,
    resolutionSources: value.resolutionSources,
    createdAt: value.createdAt,
  });
}
