import type { GeneratedMarketKind } from "./generatedMarketOptions.ts";

/**
 * The metadata payload a market carries: the question a resolver answers and
 * the criteria it answers it by. Mirrors the protocol's canonical metadata
 * schema — `version` is that schema's version, not this file's.
 */
export type MarketMetadata = {
  readonly category: string;
  readonly createdAt: string;
  readonly description: string;
  readonly question: string;
  readonly resolutionCriteria: string;
  readonly resolutionSources?: readonly string[];
  readonly resolutionUrl?: string;
  readonly version: number;
};

/**
 * One generated local-dev market, complete enough to create onchain: its
 * metadata plus the two deadlines the protocol helper needs, both measured in
 * seconds from creation.
 */
export type GeneratedMarket = {
  readonly graduationSeconds: number;
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
