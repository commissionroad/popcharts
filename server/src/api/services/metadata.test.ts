import { describe, expect, it } from "bun:test";

import {
  canonicalizeMarketMetadata,
  serializeMarketMetadata,
} from "./metadata";

describe("market metadata", () => {
  it("canonicalizes and serializes metadata in hash-stable key order", () => {
    const metadata = canonicalizeMarketMetadata({
      category: "Crypto",
      createdAt: "2026-06-13T12:00:00.000Z",
      description: "  A market about BTC. ",
      question: " Will BTC close above $100k? ",
      resolutionCriteria: " Use the Coinbase daily close. ",
      resolutionUrl: " https://example.com/btc ",
    });

    expect(metadata).toEqual({
      category: "Crypto",
      createdAt: "2026-06-13T12:00:00.000Z",
      description: "A market about BTC.",
      question: "Will BTC close above $100k?",
      resolutionCriteria: "Use the Coinbase daily close.",
      resolutionUrl: "https://example.com/btc",
      version: 1,
    });
    expect(serializeMarketMetadata(metadata)).toBe(
      '{"version":1,"question":"Will BTC close above $100k?","description":"A market about BTC.","category":"Crypto","resolutionCriteria":"Use the Coinbase daily close.","resolutionUrl":"https://example.com/btc","createdAt":"2026-06-13T12:00:00.000Z"}',
    );
  });

  it("omits an empty resolution URL from canonical metadata", () => {
    const metadata = canonicalizeMarketMetadata({
      category: "Sports",
      createdAt: "2026-06-13T12:00:00.000Z",
      description: "Description",
      question: "Question?",
      resolutionCriteria: "Criteria",
      resolutionUrl: " ",
    });

    expect("resolutionUrl" in metadata).toBe(false);
  });
});
