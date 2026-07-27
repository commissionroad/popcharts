import type { MarketCategory } from "@/domain/markets/types";
import type { MarketMetadata as ProtocolMarketMetadata } from "@/integrations/contracts/market-metadata";

export type GraduationPresetLabel = "1h" | "6h" | "24h";
export type ResolutionPresetLabel = "1d" | "1w" | "1m";

export type CreateMarketDraft = {
  category: MarketCategory;
  bypassAiResolution: boolean;
  createdAt: string;
  description: string;
  graduationPreset: GraduationPresetLabel | "custom";
  graduationTime: string;
  liquidityParameter: number;
  openingProbability: number;
  outcomeNo: string;
  outcomeYes: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources: string;
  resolutionPreset: ResolutionPresetLabel | "custom";
  resolutionTime: string;
  resolutionUrl: string;
};

export type CreateMarketDraftField = keyof CreateMarketDraft | "graduationThreshold";

export type CreateMarketValidationErrors = Partial<
  Record<CreateMarketDraftField, string>
>;

/**
 * The protocol metadata schema with `category` narrowed to the categories the
 * create form offers. Derived from the protocol type rather than restated, so
 * a field added to the schema reaches the app without a second edit.
 */
export type MarketMetadata = Omit<ProtocolMarketMetadata, "category"> & {
  category: MarketCategory;
};

export type ProtocolCreateMarketParams = {
  collateral: `0x${string}`;
  bypassAiResolution: boolean;
  graduationThreshold: bigint;
  graduationDeadline: bigint;
  liquidityParameter: bigint;
  metadataHash: `0x${string}`;
  metadata: string;
  openingProbabilityWad: bigint;
  resolutionTime: bigint;
  yesNotBefore: bigint;
};

export type CreateMarketPreview = {
  collateralSymbol: "pUSD";
  graduationThreshold: number;
  metadata: MarketMetadata;
  metadataHash: `0x${string}`;
  metadataPayload: string;
  protocolParams: ProtocolCreateMarketParams;
};

export type CreatedMarket = CreateMarketPreview & {
  chainId?: number;
  creationMode: "devchain" | "mock";
  creationSigner?: "server" | "wallet";
  creator?: `0x${string}`;
  marketId: string;
  metadataSyncError?: string;
  transactionHash?: `0x${string}`;
};
