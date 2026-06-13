import type { IndexedMarket } from "@/integrations/indexer/markets-api";

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

export function indexedMarketToMarket(indexed: IndexedMarket): Market {
  const yesPriceCents = wadToCents(indexed.openingProbabilityWad);
  const noPriceCents = 100 - yesPriceCents;
  const totalEscrowed = wadToNumber(indexed.totalEscrowed);

  return {
    b: wadToNumber(indexed.liquidityParameter),
    category: categoryForIndexedMarket(indexed),
    closesAt: indexed.resolutionTime,
    description: marketDescription(indexed),
    graduationTargetUsd: wadToNumber(indexed.graduationThreshold),
    id: indexedMarketAppId(indexed),
    matchedUsd: totalEscrowed,
    noPriceCents,
    openingProbability: yesPriceCents,
    pricePath: buildPricePath(yesPriceCents),
    question: `Market #${indexed.marketId}`,
    receiptCount: bigintStringToNumber(indexed.receiptCount),
    status: indexed.status satisfies MarketStatus,
    volumeUsd: totalEscrowed,
    yesPriceCents,
  };
}

export function indexedMarketAppId({
  chainId,
  marketId,
}: Pick<IndexedMarket, "chainId" | "marketId">) {
  return `${chainId}:${marketId}`;
}

export function parseIndexedMarketAppId(id: string) {
  const [chainIdValue, marketId, ...rest] = id.split(":");
  const chainId = Number.parseInt(chainIdValue ?? "", 10);

  if (!chainIdValue || !marketId || rest.length > 0 || Number.isNaN(chainId)) {
    return null;
  }

  return { chainId, marketId };
}

function marketDescription(indexed: IndexedMarket) {
  return [
    `Indexed market created by ${shortAddress(indexed.creator)}.`,
    `Metadata hash ${shortHash(indexed.metadataHash)}.`,
  ].join(" ");
}

function categoryForIndexedMarket(indexed: IndexedMarket): MarketCategory {
  const numericMarketId = Number.parseInt(indexed.marketId, 10);
  const index = Number.isNaN(numericMarketId)
    ? indexed.chainId
    : numericMarketId + indexed.chainId;

  return generatedCategories[index % generatedCategories.length] ?? "Econ";
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
