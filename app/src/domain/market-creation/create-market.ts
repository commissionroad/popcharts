import { keccak256, stringToBytes } from "viem";

import { MARKET_CATEGORIES } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";

import type {
  CreateMarketDraft,
  CreateMarketPreview,
  CreateMarketValidationErrors,
  GraduationPresetLabel,
  MarketMetadata,
  ProtocolCreateMarketParams,
  ResolutionPresetLabel,
} from "./types";

const WAD_DECIMALS = 1_000_000n;

export const COLLATERAL_SYMBOL = "pUSD";
export const MOCK_COLLATERAL_ADDRESS = "0x0000000000000000000000000000000000000001";

export const DEFAULT_LIQUIDITY_PARAMETER = 5_000;
export const MIN_PUBLIC_LIQUIDITY_PARAMETER = 500;
export const MAX_PUBLIC_LIQUIDITY_PARAMETER = 10_000;
export const GRADUATION_THRESHOLD_MULTIPLE = 0.5;
export const MAX_OUTCOME_LABEL_LENGTH = 40;
export const GRADUATION_PRESETS = [
  { label: "1h", milliseconds: 60 * 60 * 1000 },
  { label: "6h", milliseconds: 6 * 60 * 60 * 1000 },
  { label: "24h", milliseconds: 24 * 60 * 60 * 1000 },
] as const;
export const RESOLUTION_PRESETS = [
  { label: "1d", milliseconds: 24 * 60 * 60 * 1000 },
  { label: "1w", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { label: "1m", milliseconds: 30 * 24 * 60 * 60 * 1000 },
] as const;

export function createInitialMarketDraft(now = new Date()): CreateMarketDraft {
  return {
    bypassAiResolution: false,
    category: "Crypto",
    createdAt: now.toISOString(),
    description: "",
    graduationPreset: GRADUATION_PRESETS[0].label,
    graduationTime: toDateTimeLocalValue(
      addMilliseconds(now, GRADUATION_PRESETS[0].milliseconds)
    ),
    liquidityParameter: DEFAULT_LIQUIDITY_PARAMETER,
    openingProbability: 50,
    outcomeNo: "",
    outcomeYes: "",
    question: "",
    resolutionCriteria: "",
    resolutionSources: "",
    resolutionPreset: RESOLUTION_PRESETS[1].label,
    resolutionTime: toDateTimeLocalValue(
      addMilliseconds(now, RESOLUTION_PRESETS[1].milliseconds)
    ),
    resolutionUrl: "",
  };
}

export function buildMarketMetadata(draft: CreateMarketDraft): MarketMetadata {
  const outcomeYes = draft.outcomeYes.trim();
  const outcomeNo = draft.outcomeNo.trim();
  const baseMetadata = {
    category: draft.category,
    createdAt: draft.createdAt,
    description: draft.description.trim(),
    ...(outcomeNo ? { outcomeNo } : {}),
    ...(outcomeYes ? { outcomeYes } : {}),
    question: draft.question.trim(),
    resolutionCriteria: draft.resolutionCriteria.trim(),
    version: 1 as const,
  };
  const resolutionSources = parseResolutionSources(
    draft.resolutionSources || draft.resolutionUrl
  );
  const resolutionUrl = draft.resolutionUrl.trim();
  const sourceMetadata =
    resolutionSources.length > 0 ? { resolutionSources } : undefined;

  if (!resolutionUrl) {
    if (sourceMetadata) {
      return {
        ...baseMetadata,
        ...sourceMetadata,
      };
    }

    return baseMetadata;
  }

  return {
    ...baseMetadata,
    ...sourceMetadata,
    resolutionUrl,
  };
}

export function buildCreateMarketPreview(
  draft: CreateMarketDraft
): CreateMarketPreview {
  const metadata = buildMarketMetadata(draft);
  const metadataPayload = serializeMarketMetadata(metadata);
  const metadataHash = createMetadataHashFromPayload(metadataPayload);

  return {
    collateralSymbol: COLLATERAL_SYMBOL,
    graduationThreshold: deriveGraduationThreshold(draft.liquidityParameter),
    metadata,
    metadataHash,
    metadataPayload,
    protocolParams: buildProtocolCreateMarketParams(
      draft,
      metadataHash,
      metadataPayload
    ),
  };
}

export function buildProtocolCreateMarketParams(
  draft: CreateMarketDraft,
  metadataHash: `0x${string}`,
  metadataPayload = serializeMarketMetadata(buildMarketMetadata(draft))
): ProtocolCreateMarketParams {
  return {
    bypassAiResolution: draft.bypassAiResolution,
    collateral: MOCK_COLLATERAL_ADDRESS,
    graduationDeadline: dateTimeLocalToUnixSeconds(draft.graduationTime),
    graduationThreshold: amountToWad(
      deriveGraduationThreshold(draft.liquidityParameter)
    ),
    liquidityParameter: amountToWad(draft.liquidityParameter),
    metadataHash,
    metadata: metadataPayload,
    openingProbabilityWad: percentageToWad(draft.openingProbability),
    resolutionTime: dateTimeLocalToUnixSeconds(draft.resolutionTime),
  };
}

export function validateCreateMarketDraft(
  draft: CreateMarketDraft,
  now = new Date()
): CreateMarketValidationErrors {
  const errors: CreateMarketValidationErrors = {};
  const graduationDate = dateTimeLocalToDate(draft.graduationTime);
  const resolutionDate = dateTimeLocalToDate(draft.resolutionTime);

  if (!draft.question.trim()) {
    errors.question = "Add a market question.";
  }

  if (!MARKET_CATEGORIES.includes(draft.category)) {
    errors.category = "Choose a supported category.";
  }

  if (!draft.resolutionCriteria.trim()) {
    errors.resolutionCriteria = "Add resolution criteria.";
  }

  if (draft.outcomeYes.trim().length > MAX_OUTCOME_LABEL_LENGTH) {
    errors.outcomeYes = `Keep the YES label under ${MAX_OUTCOME_LABEL_LENGTH} characters.`;
  }

  if (draft.outcomeNo.trim().length > MAX_OUTCOME_LABEL_LENGTH) {
    errors.outcomeNo = `Keep the NO label under ${MAX_OUTCOME_LABEL_LENGTH} characters.`;
  }

  const invalidSource = parseResolutionSources(draft.resolutionSources).find(
    (source) => looksLikeUrl(source) && !isHttpUrl(source)
  );

  if (invalidSource) {
    errors.resolutionSources = "Use http or https for source URLs.";
  }

  if (draft.resolutionUrl.trim() && !isHttpUrl(draft.resolutionUrl.trim())) {
    errors.resolutionUrl = "Use a valid http or https URL.";
  }

  if (
    !Number.isFinite(draft.openingProbability) ||
    draft.openingProbability < 2 ||
    draft.openingProbability > 98
  ) {
    errors.openingProbability = "Choose an opening YES probability from 2% to 98%.";
  }

  if (
    !Number.isFinite(draft.liquidityParameter) ||
    draft.liquidityParameter < MIN_PUBLIC_LIQUIDITY_PARAMETER ||
    draft.liquidityParameter > MAX_PUBLIC_LIQUIDITY_PARAMETER
  ) {
    errors.liquidityParameter = "Choose b from 500 to 10,000.";
  }

  if (deriveGraduationThreshold(draft.liquidityParameter) <= 0) {
    errors.graduationThreshold = "Graduation target must be greater than zero.";
  }

  if (!graduationDate) {
    errors.graduationTime = "Choose a graduation deadline.";
  } else if (graduationDate.getTime() <= now.getTime()) {
    errors.graduationTime = "Graduation deadline must be in the future.";
  }

  if (!resolutionDate) {
    errors.resolutionTime = "Choose a resolution deadline.";
  } else if (resolutionDate.getTime() <= now.getTime()) {
    errors.resolutionTime = "Resolution deadline must be in the future.";
  }

  if (
    graduationDate &&
    resolutionDate &&
    graduationDate.getTime() >= resolutionDate.getTime()
  ) {
    errors.graduationTime ??= "Graduation deadline must be before resolution.";
    errors.resolutionTime ??= "Resolution deadline must be after graduation.";
  }

  return errors;
}

export function deriveGraduationThreshold(liquidityParameter: number) {
  return liquidityParameter * GRADUATION_THRESHOLD_MULTIPLE;
}

export function applyGraduationTime(
  draft: CreateMarketDraft,
  graduationTime: string,
  graduationPreset: GraduationPresetLabel | "custom" = "custom"
): CreateMarketDraft {
  return {
    ...draft,
    graduationPreset,
    graduationTime,
  };
}

export function applyResolutionTime(
  draft: CreateMarketDraft,
  resolutionTime: string,
  resolutionPreset: ResolutionPresetLabel | "custom" = "custom"
): CreateMarketDraft {
  return {
    ...draft,
    resolutionPreset,
    resolutionTime,
  };
}

export function toDateTimeLocalValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function dateTimeLocalToDate(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDeadline(value: string) {
  const date = dateTimeLocalToDate(value);

  if (!date) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function createMetadataHash(metadata: MarketMetadata): `0x${string}` {
  return createMetadataHashFromPayload(serializeMarketMetadata(metadata));
}

function createMetadataHashFromPayload(metadataPayload: string): `0x${string}` {
  return keccak256(stringToBytes(metadataPayload));
}

export function serializeMarketMetadata(metadata: MarketMetadata) {
  const ordered: Record<string, string | number | string[]> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.outcomeYes) {
    ordered.outcomeYes = metadata.outcomeYes;
  }

  if (metadata.outcomeNo) {
    ordered.outcomeNo = metadata.outcomeNo;
  }

  if (metadata.resolutionSources?.length) {
    ordered.resolutionSources = metadata.resolutionSources;
  }

  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

function addMilliseconds(date: Date, milliseconds: number) {
  return new Date(date.getTime() + milliseconds);
}

function dateTimeLocalToUnixSeconds(value: string) {
  const date = dateTimeLocalToDate(value);

  if (!date) {
    return 0n;
  }

  return BigInt(Math.floor(date.getTime() / 1000));
}

function amountToWad(amount: number) {
  return (BigInt(Math.round(amount * Number(WAD_DECIMALS))) * WAD) / WAD_DECIMALS;
}

function percentageToWad(percentage: number) {
  return (
    (BigInt(Math.round(percentage * Number(WAD_DECIMALS))) * WAD) /
    (100n * WAD_DECIMALS)
  );
}

function parseResolutionSources(value: string) {
  return value
    .split(/[\n,]+/)
    .flatMap((source) => (source.includes("://") ? [source] : source.split("/")))
    .map((source) => source.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeUrl(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}
