import { keccak256, stringToBytes } from "viem";

import { parseMarketMetadata, serializeMarketMetadata } from "#src/market/marketMetadataSchema.js";
import type { MarketMetadata } from "#src/market/marketMetadataSchema.js";

/**
 * Hashing and the local-smoke fixture for market metadata. The schema itself —
 * the accepted fields and the hashed byte layout — lives in
 * `src/market/marketMetadataSchema.ts` so the root `scripts/` tree, the app,
 * and the indexer share one definition; only the viem-dependent hash lives
 * here. Re-exported so existing protocol-script callers keep one import site.
 */
export { parseMarketMetadata, serializeMarketMetadata };
export type { MarketMetadata };

/** Metadata for the direct-protocol smoke market used to exercise indexer recovery. */
export function buildLocalSmokeMarketMetadata(): MarketMetadata {
  const createdAt = new Date().toISOString();

  return {
    category: "Crypto",
    createdAt,
    description: "Local smoke market created by the direct protocol helper for indexer recovery.",
    question: `Will the local Pop Charts smoke market created at ${createdAt} be indexed?`,
    resolutionCriteria:
      "Resolves YES if the local development indexer records this direct contract-created market.",
    resolutionSources: ["Local Hardhat chain", "Pop Charts local indexer"],
    version: 1,
  };
}

/**
 * Computes the on-chain metadata commitment. The indexer recomputes this from
 * the payload carried in the creation event and rejects a mismatch, so the
 * bytes must come from the canonical serializer.
 */
export function hashMarketMetadata(metadata: MarketMetadata): `0x${string}` {
  return keccak256(stringToBytes(serializeMarketMetadata(metadata)));
}
