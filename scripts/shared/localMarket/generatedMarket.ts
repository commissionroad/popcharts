// Cross-workspace import by relative path: these scripts run under
// node --experimental-strip-types, which cannot resolve the protocol package's
// exports map or the ".js"-suffixed relative imports its modules use
// internally — so the schema is shared as a dependency-free leaf module rather
// than mirrored here.
import type { MarketMetadata } from "../../../protocol/src/market/marketMetadataSchema.ts";

import type { GeneratedMarketKind } from "./generatedMarketOptions.ts";

/**
 * The metadata payload a market carries: the question a resolver answers and
 * the criteria it answers it by. Re-exported from the protocol's canonical
 * schema so the generators here cannot accept a shape the hashed payload
 * cannot carry.
 */
export type { MarketMetadata };

/**
 * One generated local-dev market, complete enough to create onchain: its
 * metadata plus the two deadlines the protocol helper needs, both measured in
 * seconds from creation.
 */
export type GeneratedMarket = {
  readonly graduationSeconds: number;
  /**
   * Authored so the resolution criteria contradict the question. Carried on the
   * result because only the caller knows what review then did with it — and an
   * incoherent market that gets approved is a finding, not a normal run.
   */
  readonly incoherent: boolean;
  readonly kind: GeneratedMarketKind;
  readonly metadata: MarketMetadata;
  readonly resolutionSeconds: number;
};

/**
 * The lifetime every generated local market gets. Short enough that a developer
 * can watch a market graduate and resolve within one session, and far enough
 * apart that the graduation deadline lands well before resolution. The market
 * text derives its threshold from the resolution window, so these two values
 * and the questions that quote them stay together.
 */
export const localMarketGraduationSeconds = 60 * 60;
export const localMarketResolutionSeconds = 2 * 60 * 60;
