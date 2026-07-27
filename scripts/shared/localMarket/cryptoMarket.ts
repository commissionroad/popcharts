import { isRecord } from "../json/readJsonPath.ts";
import { fetchJson } from "../net/fetchJson.ts";
import { addSeconds, formatUtc } from "../time/utcTime.ts";
import {
  localMarketGraduationSeconds,
  localMarketResolutionSeconds,
  type GeneratedMarket,
  type MarketMetadata,
} from "./generatedMarket.ts";
import type { GeneratedMarketDirection } from "./generatedMarketOptions.ts";

/** A digital asset a generated crypto market can be written about. */
export type DigitalAsset = {
  readonly id: string;
  readonly symbol: string;
};

/** One crypto market the generator may build: an asset and a direction. */
export type CryptoMarketOption = {
  readonly asset: DigitalAsset;
  readonly direction: GeneratedMarketDirection;
  readonly key: string;
  readonly kind: "crypto";
};

/**
 * The assets generated crypto markets are written about. `id` is the spot-price
 * source's own identifier; `symbol` is what the question says.
 */
export const digitalAssets: readonly DigitalAsset[] = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
];

// The query is built from the catalogue above so adding an asset cannot leave
// the source URL — which is also the market's published resolution source —
// asking about a different set of assets than the generator offers.
const spotPriceSourceUrl =
  "https://api.coingecko.com/api/v3/simple/price" +
  `?ids=${digitalAssets.map((asset) => asset.id).join(",")}` +
  "&vs_currencies=usd";

/**
 * Builds a crypto market whose threshold is the asset's live spot price, so the
 * generated market is genuinely near even odds at creation. Throws when the
 * source has no usable price for the asset — the caller tries another option
 * rather than creating a market against a made-up threshold.
 */
export async function buildCryptoMarket(
  option: CryptoMarketOption,
): Promise<GeneratedMarket> {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const { asset, direction } = option;
  const prices = await fetchJson(spotPriceSourceUrl);
  const price = readSpotPrice(prices, asset.id);
  const threshold = formatUsd(price);
  const metadata: MarketMetadata = {
    category: "Crypto",
    createdAt: now.toISOString(),
    description:
      `Auto-generated local-dev market using the live ${asset.symbol}/USD ` +
      `spot price as its threshold.`,
    question:
      `Will ${asset.symbol}/USD be ${direction} than ${threshold} at ` +
      `${formatUtc(resolutionAt)}?`,
    resolutionCriteria:
      `Resolve YES if the linked spot-price source reports ${asset.symbol}/USD ` +
      `strictly ${direction} than ${threshold} at or immediately after ` +
      `${formatUtc(resolutionAt)}. If no reading is available at that moment, ` +
      `use the first reading from the same source within 15 minutes after the ` +
      `resolution time. Ties resolve NO.`,
    resolutionUrl: spotPriceSourceUrl,
    version: 1,
  };

  return {
    graduationSeconds: localMarketGraduationSeconds,
    kind: "crypto",
    metadata,
    resolutionSeconds: localMarketResolutionSeconds,
  };
}

function readSpotPrice(value: unknown, assetId: string): number {
  if (!isRecord(value) || !isRecord(value[assetId])) {
    throw new Error(`Spot price response did not include ${assetId}.`);
  }

  const price = (value[assetId] as Record<string, unknown>).usd;

  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Spot price for ${assetId} was not a positive number.`);
  }

  return price;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(value);
}
