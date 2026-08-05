import type { MarketMetadata } from "@/integrations/contracts/market-metadata";

/**
 * One generated local-dev market as it crosses from the dev API route to the
 * browser: the market's metadata plus its two deadlines as absolute ISO
 * instants, already anchored to the metadata's own creation time.
 *
 * This module deliberately imports nothing from the root scripts/ tree, so the
 * browser side of the tool can name the shape without reaching across the
 * workspace boundary its generator lives behind.
 */
export type GeneratedLocalMarket = {
  readonly graduationAt: string;
  readonly metadata: MarketMetadata;
  readonly resolutionAt: string;
};
