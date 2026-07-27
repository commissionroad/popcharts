// Cross-workspace import by relative path: this script runs under
// node --experimental-strip-types, which cannot resolve the protocol package's
// exports map or the ".js"-suffixed relative imports its modules use
// internally — so the serializer is shared as a dependency-free leaf module
// rather than mirrored here.
import { serializeMarketMetadata } from "../../../protocol/src/market/marketMetadataSchema.ts";
import type { ProtocolChainEnv } from "../localStack/protocolChainEnv.ts";
import type { GeneratedMarket } from "./generatedMarket.ts";

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
    LOCAL_MARKET_METADATA: serializeMarketMetadata(generatedMarket.metadata),
    LOCAL_MARKET_RESOLUTION_SECONDS: String(generatedMarket.resolutionSeconds),
  };
}
