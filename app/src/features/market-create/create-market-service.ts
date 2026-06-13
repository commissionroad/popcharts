import {
  buildCreateMarketPreview,
  validateCreateMarketDraft,
} from "@/domain/market-creation/create-market";
import type { CreatedMarket, CreateMarketDraft } from "@/domain/market-creation/types";
import {
  getPopChartsContractConfig,
  marketCreationMode,
} from "@/integrations/contracts/config";
import { serializeProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";

export async function createMockMarket(
  draft: CreateMarketDraft
): Promise<CreatedMarket> {
  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot create an invalid market draft.");
  }

  const preview = buildCreateMarketPreview(draft);

  await new Promise((resolve) => window.setTimeout(resolve, 180));

  return {
    ...preview,
    creationMode: "mock",
    marketId: `draft-${preview.metadataHash.slice(2, 8)}`,
  };
}

export async function createMarket(draft: CreateMarketDraft): Promise<CreatedMarket> {
  if (marketCreationMode !== "devchain") {
    return createMockMarket(draft);
  }

  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot create an invalid market draft.");
  }

  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Devchain contract configuration is incomplete.");
  }

  const preview = buildCreateMarketPreview(draft);
  const chainPreview = {
    ...preview,
    protocolParams: {
      ...preview.protocolParams,
      collateral: config.collateralAddress,
    },
  };
  const response = await fetch("/api/devchain/markets", {
    body: JSON.stringify({
      metadata: chainPreview.metadata,
      protocolParams: serializeProtocolCreateMarketParams(chainPreview.protocolParams),
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    error?: string;
    marketId?: string;
    transactionHash?: `0x${string}`;
  };

  if (!response.ok || !body.marketId || !body.transactionHash) {
    throw new Error(body.error ?? "The devchain creation service failed.");
  }

  return {
    ...chainPreview,
    creationMode: "devchain",
    marketId: body.marketId,
    transactionHash: body.transactionHash,
  };
}
