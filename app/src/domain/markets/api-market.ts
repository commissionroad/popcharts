import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBuy,
  type VirtualLmsrState,
} from "@/domain/lmsr/lmsr";
import type {
  ApiMarket,
  ApiReceiptPlacedEvent,
} from "@/integrations/indexer/markets-api";

import type { Market, MarketCategory, MarketStatus } from "./types";

const WAD = 10n ** 18n;
const MAX_PRICE_PATH_POINTS = 256;

const generatedCategories: MarketCategory[] = [
  "Crypto",
  "Politics",
  "Sports",
  "Weather",
  "Culture",
  "Tech",
  "Econ",
];

export function apiMarketToMarket(apiMarket: ApiMarket): Market {
  const b = wadToNumber(apiMarket.liquidityParameter);
  const openingProbability = wadToCents(apiMarket.openingProbabilityWad);
  const currentState = currentLmsrState({
    b,
    noShares: wadToNumber(apiMarket.noShares),
    openingProbability,
    yesShares: wadToNumber(apiMarket.yesShares),
  });
  const yesPriceCents = marginalPriceCents(currentState, "yes");
  const noPriceCents = 100 - yesPriceCents;
  const matchedMarketCap = wadToNumber(apiMarket.matchedMarketCap);
  const totalEscrowed = wadToNumber(apiMarket.totalEscrowed);
  const metadata = apiMarket.metadata;

  const resolutionCriteria = metadata?.resolutionCriteria?.trim();
  const resolutionSources = (metadata?.resolutionSources ?? []).filter(
    (source) => source.trim().length > 0
  );
  const resolutionUrl = metadata?.resolutionUrl?.trim();

  return {
    b,
    category: categoryForApiMarket(apiMarket),
    chainId: apiMarket.chainId,
    closesAt: apiMarket.resolutionTime,
    createdAt: apiMarket.createdAt,
    creator: apiMarket.creator,
    description: marketDescription(apiMarket),
    graduationTargetUsd: wadToNumber(apiMarket.graduationThreshold),
    id: apiMarketAppId(apiMarket),
    matchedUsd: matchedMarketCap,
    metadataHash: apiMarket.metadataHash,
    noPriceCents,
    openingProbability,
    pricePath: buildPricePath(openingProbability, yesPriceCents),
    question: metadata?.question?.trim() || `Market #${apiMarket.marketId}`,
    receiptCount: bigintStringToNumber(apiMarket.receiptCount),
    status: apiMarket.status satisfies MarketStatus,
    volumeUsd: totalEscrowed,
    yesPriceCents,
    ...(apiMarket.aiReview ? { aiReview: apiMarket.aiReview } : {}),
    ...(resolutionCriteria ? { resolutionCriteria } : {}),
    ...(resolutionSources.length > 0 ? { resolutionSources } : {}),
    ...(resolutionUrl ? { resolutionUrl } : {}),
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

function currentLmsrState({
  b,
  noShares,
  openingProbability,
  yesShares,
}: {
  b: number;
  noShares: number;
  openingProbability: number;
  yesShares: number;
}): VirtualLmsrState {
  const openingState = createOpeningState({ b, openingProbability });

  return {
    ...openingState,
    noShares: openingState.noShares + noShares,
    yesShares: openingState.yesShares + yesShares,
  };
}

/**
 * Replays indexed ReceiptPlaced events through the virtual LMSR to recover the
 * market's actual price history: the opening price followed by the implied YES
 * price after each receipt, in on-chain sequence order. Long histories are
 * downsampled to MAX_PRICE_PATH_POINTS while always keeping the first and
 * latest prices.
 */
export function pricePathFromReceipts(
  market: Pick<Market, "b" | "openingProbability">,
  receipts: ApiReceiptPlacedEvent[]
) {
  let state = createOpeningState({
    b: market.b,
    openingProbability: market.openingProbability,
  });
  const path = [marginalPriceCents(state, "yes")];

  const ordered = [...receipts].sort((a, b) =>
    parseBigInt(a.sequence) < parseBigInt(b.sequence) ? -1 : 1
  );

  for (const receipt of ordered) {
    state = stateAfterBuy({
      shares: wadToNumber(receipt.shares),
      side: receipt.side === 0 ? "yes" : "no",
      state,
    });
    path.push(marginalPriceCents(state, "yes"));
  }

  return downsamplePricePath(path, MAX_PRICE_PATH_POINTS);
}

function downsamplePricePath(path: number[], maxPoints: number) {
  if (path.length <= maxPoints) {
    return path;
  }

  const stride = (path.length - 1) / (maxPoints - 1);

  return Array.from(
    { length: maxPoints },
    (_, index) => path[Math.round(index * stride)] ?? 0
  );
}

function buildPricePath(openingPriceCents: number, currentPriceCents: number) {
  const steps = 5;
  const stride = (currentPriceCents - openingPriceCents) / (steps - 1);

  return Array.from(
    { length: steps },
    (_, index) => openingPriceCents + stride * index
  );
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
