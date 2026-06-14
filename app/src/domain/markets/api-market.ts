import type { ApiMarket } from "@/integrations/indexer/markets-api";

import type { Market, MarketCategory, MarketStatus } from "./types";

const WAD = 10n ** 18n;

const generatedCategories: MarketCategory[] = [
  "Crypto",
  "Politics",
  "Sports",
  "Culture",
  "Tech",
  "Econ",
];

export function apiMarketToMarket(apiMarket: ApiMarket): Market {
  const yesPriceCents = wadToCents(apiMarket.openingProbabilityWad);
  const noPriceCents = 100 - yesPriceCents;
  const totalEscrowed = wadToNumber(apiMarket.totalEscrowed);
  const metadata = apiMarket.metadata;

  return {
    b: wadToNumber(apiMarket.liquidityParameter),
    category: categoryForApiMarket(apiMarket),
    chainId: apiMarket.chainId,
    closesAt: apiMarket.resolutionTime,
    description: marketDescription(apiMarket),
    graduationTargetUsd: wadToNumber(apiMarket.graduationThreshold),
    id: apiMarketAppId(apiMarket),
    matchedUsd: totalEscrowed,
    noPriceCents,
    openingProbability: yesPriceCents,
    pricePath: buildPricePath(yesPriceCents),
    question: metadata?.question?.trim() || `Market #${apiMarket.marketId}`,
    receiptCount: bigintStringToNumber(apiMarket.receiptCount),
    status: apiMarket.status satisfies MarketStatus,
    volumeUsd: totalEscrowed,
    yesPriceCents,
  };
}

export function apiMarketAppId({
  chainId,
  marketId,
}: Pick<ApiMarket, "chainId" | "marketId">) {
  return `${chainId}:${marketId}`;
}

export function parseApiMarketAppId(id: string) {
  const decodedId = decodePathSegment(id);
  const [chainIdValue, marketId, ...rest] = decodedId.split(":");
  const chainId = Number.parseInt(chainIdValue ?? "", 10);

  if (!chainIdValue || !marketId || rest.length > 0 || Number.isNaN(chainId)) {
    return null;
  }

  return { chainId, marketId };
}

function marketDescription(apiMarket: ApiMarket) {
  const metadataDescription = apiMarket.metadata?.description?.trim();

  if (metadataDescription) {
    return metadataDescription;
  }

  return [
    `Market created by ${shortAddress(apiMarket.creator)}.`,
    `Metadata hash ${shortHash(apiMarket.metadataHash)}.`,
  ].join(" ");
}

function categoryForApiMarket(apiMarket: ApiMarket): MarketCategory {
  const metadataCategory = apiMarket.metadata?.category;

  if (isMarketCategory(metadataCategory)) {
    return metadataCategory;
  }

  const numericMarketId = Number.parseInt(apiMarket.marketId, 10);
  const index = Number.isNaN(numericMarketId)
    ? apiMarket.chainId
    : numericMarketId + apiMarket.chainId;

  return generatedCategories[index % generatedCategories.length] ?? "Econ";
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isMarketCategory(value: string | undefined): value is MarketCategory {
  return Boolean(value && generatedCategories.includes(value as MarketCategory));
}

function buildPricePath(priceCents: number) {
  return [priceCents, priceCents, priceCents, priceCents, priceCents];
}

function wadToCents(value: string) {
  const wad = parseBigInt(value);
  const cents = Number((wad * 100n + WAD / 2n) / WAD);

  return clamp(cents, 1, 99);
}

function wadToNumber(value: string) {
  const wad = parseBigInt(value);
  const whole = wad / WAD;
  const fractional = wad % WAD;

  return Number(whole) + Number(fractional) / Number(WAD);
}

function bigintStringToNumber(value: string) {
  return Number(parseBigInt(value));
}

function parseBigInt(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}
