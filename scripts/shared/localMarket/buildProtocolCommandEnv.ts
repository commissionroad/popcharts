import type { ProtocolChainEnv } from "../localStack/protocolChainEnv.ts";
import type { GeneratedMarket, MarketMetadata } from "./generatedMarket.ts";

/**
 * The exact environment the protocol helper is spawned with: the caller's
 * environment and the loaded env file, then the chain variables that decide
 * which devchain the child talks to, then the generated market it should
 * create. Built in one place so the chain pin cannot drift away from the
 * spawn: a resolved target that never reaches the child is the failure mode
 * this guards (ADR 0020 Phase 4 correction).
 */
export function buildProtocolCommandEnv({
  baseEnv,
  chainEnv,
  generatedMarket,
}: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly chainEnv: ProtocolChainEnv;
  readonly generatedMarket: GeneratedMarket;
}): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...chainEnv,
    LOCAL_MARKET_GRADUATION_SECONDS: String(generatedMarket.graduationSeconds),
    LOCAL_MARKET_METADATA: serializeMetadata(generatedMarket.metadata),
    LOCAL_MARKET_RESOLUTION_SECONDS: String(generatedMarket.resolutionSeconds),
  };
}

function serializeMetadata(metadata: MarketMetadata): string {
  // Key order mirrors the protocol's canonical schema so the payload round-trips
  // through its `parseMarketMetadata`. It does NOT determine the metadata hash:
  // the protocol helper re-serializes with its own `serializeMarketMetadata`
  // before hashing, so that module owns the hashed byte layout.
  const ordered: Record<string, unknown> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionSources?.length) {
    ordered.resolutionSources = metadata.resolutionSources;
  }
  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}
