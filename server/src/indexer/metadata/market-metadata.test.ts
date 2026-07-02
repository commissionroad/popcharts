import { describe, expect, it } from "bun:test";
import { keccak256, stringToBytes } from "viem";

import { resolveMarketMetadataFromUri } from "./market-metadata";

const metadata = {
  category: "Crypto",
  createdAt: "2026-07-02T12:00:00.000Z",
  description: "Resolve using public local smoke evidence.",
  question: "Will direct market creation carry metadata?",
  resolutionCriteria:
    "YES if the indexer can recover metadata from the creation event URI.",
  resolutionSources: ["CNN", "NPR", "https://www.bbc.com/news"],
  version: 1 as const,
};

describe("resolveMarketMetadataFromUri", () => {
  it("parses canonical JSON metadata from a data URI", async () => {
    const metadataUri = metadataToDataUri(metadata);
    const resolved = await resolveMarketMetadataFromUri({
      metadataHash: hashMetadata(metadata),
      metadataUri,
    });

    expect(resolved).toEqual(metadata);
  });

  it("rejects metadata whose canonical payload does not match the event hash", async () => {
    await expect(
      resolveMarketMetadataFromUri({
        metadataHash: `0x${"f".repeat(64)}`,
        metadataUri: metadataToDataUri(metadata),
      }),
    ).rejects.toThrow("Metadata hash mismatch");
  });

  it("rejects non-data metadata URIs", async () => {
    await expect(
      resolveMarketMetadataFromUri({
        metadataHash: hashMetadata(metadata),
        metadataUri: "https://example.com/metadata.json",
      }),
    ).rejects.toThrow("self-contained data URI");
  });
});

function metadataToDataUri(value: typeof metadata) {
  return `data:application/json;charset=utf-8,${encodeURIComponent(
    serializeMetadata(value),
  )}`;
}

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
