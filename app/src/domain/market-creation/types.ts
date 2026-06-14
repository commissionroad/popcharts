import type { MarketCategory } from "@/domain/markets/types";

export type GraduationPresetLabel = "1h" | "6h" | "24h";
export type ResolutionPresetLabel = "1d" | "1w" | "1m";

export type CreateMarketDraft = {
  category: MarketCategory;
  createdAt: string;
  description: string;
  graduationPreset: GraduationPresetLabel | "custom";
  graduationTime: string;
  liquidityParameter: number;
  openingProbability: number;
  question: string;
  resolutionCriteria: string;
  resolutionPreset: ResolutionPresetLabel | "custom";
  resolutionTime: string;
  resolutionUrl: string;
};

export type CreateMarketDraftField = keyof CreateMarketDraft | "graduationThreshold";

export type CreateMarketValidationErrors = Partial<
  Record<CreateMarketDraftField, string>
>;

export type MarketMetadata = {
  category: MarketCategory;
  createdAt: string;
  description: string;
  question: string;
  resolutionCriteria: string;
  resolutionUrl?: string;
  version: 1;
};

export type ProtocolCreateMarketParams = {
  collateral: `0x${string}`;
  graduationThreshold: bigint;
  graduationTime: bigint;
  liquidityParameter: bigint;
  metadataHash: `0x${string}`;
  openingProbabilityWad: bigint;
  resolutionTime: bigint;
};

export type CreateMarketPreview = {
  collateralSymbol: "pUSD";
  graduationThreshold: number;
  metadata: MarketMetadata;
  metadataHash: `0x${string}`;
  protocolParams: ProtocolCreateMarketParams;
};

export type CreatedMarket = CreateMarketPreview & {
  creationMode: "devchain" | "mock";
  creationSigner?: "server" | "wallet";
  creator?: `0x${string}`;
  marketId: string;
  transactionHash?: `0x${string}`;
};
