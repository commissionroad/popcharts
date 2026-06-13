import {
  buildCreateMarketPreview,
  validateCreateMarketDraft,
} from "@/domain/market-creation/create-market";
import type {
  CreateMarketDraft,
  MockCreatedMarket,
} from "@/domain/market-creation/types";

export async function createMockMarket(
  draft: CreateMarketDraft
): Promise<MockCreatedMarket> {
  const errors = validateCreateMarketDraft(draft);

  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot create an invalid market draft.");
  }

  const preview = buildCreateMarketPreview(draft);

  await new Promise((resolve) => window.setTimeout(resolve, 180));

  return {
    ...preview,
    marketId: `draft-${preview.metadataHash.slice(2, 8)}`,
  };
}
