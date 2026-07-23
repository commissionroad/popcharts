import {
  createOpeningState,
  marginalPriceCents,
  stateAfterBuy,
  type VirtualLmsrState,
} from "@/domain/lmsr/lmsr";
import { WAD, wadToNumber as wadBigintToNumber } from "@/domain/tokens/wad";
import { contractSideToMarketSide } from "@/integrations/contracts/market-side";
import type {
  ApiMarket,
  ApiReceiptPlacedEvent,
} from "@/integrations/indexer/markets-api";
import { apiMarketAppId } from "@/lib/app-id";

import type {
  Market,
  MarketCategory,
  MarketPostgradHandoff,
  MarketResolution,
  PricePathPoint,
} from "./types";

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
  const lmsrYesPriceCents = marginalPriceCents(currentState, "yes");
  const venuePrices =
    apiMarket.status === "graduated"
      ? venuePriceCents(apiMarket.postgrad?.venue)
      : null;
  // A settled market's prices are facts, not quotes: the winning side is
  // worth exactly one collateral unit and the loser nothing, and a cancelled
  // draw redeems both sides at half. Pregrad admin-cancelled markets carry no
  // terminal resolution event (they refund at cost, not half), so the
  // `resolution` guard keeps them on their historical prices.
  const resolvedPrices =
    apiMarket.status === "resolved" && apiMarket.resolution?.winningSide
      ? {
          noPriceCents: apiMarket.resolution.winningSide === "no" ? 100 : 0,
          yesPriceCents: apiMarket.resolution.winningSide === "yes" ? 100 : 0,
        }
      : apiMarket.status === "cancelled" && apiMarket.resolution?.kind === "cancelled"
        ? { noPriceCents: 50, yesPriceCents: 50 }
        : null;
  const yesPriceCents =
    resolvedPrices?.yesPriceCents ?? venuePrices?.yesPriceCents ?? lmsrYesPriceCents;
  const noPriceCents =
    resolvedPrices?.noPriceCents ??
    venuePrices?.noPriceCents ??
    100 - lmsrYesPriceCents;
  const matchedMarketCap = wadToNumber(apiMarket.matchedMarketCap);
  const totalEscrowed = wadToNumber(apiMarket.totalEscrowed);
  const metadata = apiMarket.metadata;

  const resolutionCriteria = metadata?.resolutionCriteria?.trim();
  const resolutionSources = (metadata?.resolutionSources ?? []).filter(
    (source) => source.trim().length > 0
  );
  const resolutionUrl = metadata?.resolutionUrl?.trim();
  const outcomeYes = metadata?.outcomeYes?.trim();
  const outcomeNo = metadata?.outcomeNo?.trim();

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
    status: apiMarket.status,
    volumeUsd: totalEscrowed,
    yesPriceCents,
    ...(apiMarket.aiReview ? { aiReview: apiMarket.aiReview } : {}),
    ...(apiMarket.aiReviewProgress
      ? { aiReviewProgress: apiMarket.aiReviewProgress }
      : {}),
    ...(outcomeNo ? { outcomeNo } : {}),
    ...(outcomeYes ? { outcomeYes } : {}),
    ...(apiMarket.postgrad
      ? { postgrad: apiPostgradToHandoff(apiMarket.postgrad) }
      : {}),
    ...(apiMarket.resolution
      ? { resolution: apiResolutionToResolution(apiMarket.resolution) }
      : {}),
    ...(resolutionCriteria ? { resolutionCriteria } : {}),
    ...(resolutionSources.length > 0 ? { resolutionSources } : {}),
    ...(resolutionUrl ? { resolutionUrl } : {}),
  };
}

/**
 * Headline YES/NO prices from a graduated market's live venue pools, read
 * from each pool's current display price. YES and NO are independent pools,
 * so the two prices are converted separately and deliberately not forced to
 * sum to 100 — a small deviation is real venue state. Returns null while the
 * venue is not live or either pool has no price yet, so callers can fall
 * back to the frozen pregrad LMSR prices.
 */
function venuePriceCents(
  venue: NonNullable<ApiMarket["postgrad"]>["venue"] | undefined
): { noPriceCents: number; yesPriceCents: number } | null {
  if (!venue?.live) {
    return null;
  }

  const noPriceWad = venue.noPool.initialized
    ? venue.noPool.displayPriceWad
    : undefined;
  const yesPriceWad = venue.yesPool.initialized
    ? venue.yesPool.displayPriceWad
    : undefined;

  if (!noPriceWad || !yesPriceWad) {
    return null;
  }

  return {
    noPriceCents: wadToCents(noPriceWad),
    yesPriceCents: wadToCents(yesPriceWad),
  };
}

function apiResolutionToResolution(
  resolution: NonNullable<ApiMarket["resolution"]>
): MarketResolution {
  return {
    kind: resolution.kind,
    postgradMarket: resolution.postgradMarket,
    resolvedAt: resolution.resolvedAt,
    ...(resolution.winningSide ? { winningSide: resolution.winningSide } : {}),
  };
}

function apiPostgradToHandoff(
  postgrad: NonNullable<ApiMarket["postgrad"]>
): MarketPostgradHandoff {
  return {
    adapterAddress: postgrad.adapterAddress,
    completeSets: wadToNumber(postgrad.completeSetCount),
    finalizedAt: postgrad.finalizedAt,
    marketAddress: postgrad.marketAddress,
    refundedUsd: wadToNumber(postgrad.refundTotal),
    retainedUsd: wadToNumber(postgrad.retainedCostTotal),
    ...(postgrad.venue ? { venue: postgrad.venue } : {}),
  };
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
 * price after each receipt, in on-chain sequence order. Each point carries the
 * timestamp of the trade behind it (the market creation time for the opening
 * point). Long histories are downsampled to MAX_PRICE_PATH_POINTS while always
 * keeping the first and latest prices.
 */
export function pricePathFromReceipts(
  market: Pick<Market, "b" | "createdAt" | "openingProbability">,
  receipts: ApiReceiptPlacedEvent[]
): PricePathPoint[] {
  let state = createOpeningState({
    b: market.b,
    openingProbability: market.openingProbability,
  });
  const path: PricePathPoint[] = [
    {
      cents: marginalPriceCents(state, "yes"),
      ...(market.createdAt ? { at: market.createdAt } : {}),
    },
  ];

  const ordered = [...receipts].sort((a, b) =>
    parseBigInt(a.sequence) < parseBigInt(b.sequence) ? -1 : 1
  );

  for (const receipt of ordered) {
    state = stateAfterBuy({
      shares: wadToNumber(receipt.shares),
      side: contractSideToMarketSide(receipt.side),
      state,
    });
    path.push({
      at: receipt.blockTimestamp,
      cents: marginalPriceCents(state, "yes"),
    });
  }

  return downsamplePricePath(path, MAX_PRICE_PATH_POINTS);
}

function downsamplePricePath(path: PricePathPoint[], maxPoints: number) {
  if (path.length <= maxPoints) {
    return path;
  }

  const stride = (path.length - 1) / (maxPoints - 1);

  return Array.from(
    { length: maxPoints },
    (_, index) => path[Math.round(index * stride)] ?? { cents: 0 }
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
  return wadBigintToNumber(parseBigInt(value));
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
