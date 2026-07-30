import { toDateTimeLocalValue } from "@/domain/market-creation/create-market";
import type { CreateMarketDraft } from "@/domain/market-creation/types";
import { isMarketCategory } from "@/domain/markets/types";
import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";

/**
 * Fills a draft from a market the dev menu generated, leaving the fields the
 * generator has no opinion about — opening probability, liquidity parameter,
 * the AI-bypass flag — exactly as the developer left them.
 *
 * `createdAt` is carried over rather than restamped because the generated
 * question quotes its own resolution time, and both deadlines are marked
 * "custom": a generated market's window is a couple of hours, which no preset
 * offers.
 */
export function applyGeneratedMarketToDraft(
  draft: CreateMarketDraft,
  market: GeneratedLocalMarket
): CreateMarketDraft {
  const { metadata } = market;

  return {
    ...draft,
    category: isMarketCategory(metadata.category) ? metadata.category : draft.category,
    createdAt: metadata.createdAt,
    description: metadata.description,
    graduationPreset: "custom",
    graduationTime: toDateTimeLocalValue(new Date(market.graduationAt)),
    outcomeNo: metadata.outcomeNo ?? "",
    outcomeYes: metadata.outcomeYes ?? "",
    question: metadata.question,
    resolutionCriteria: metadata.resolutionCriteria,
    resolutionPreset: "custom",
    // A generated market carries either an explicit source list (weather) or a
    // single resolution URL (crypto). The form derives the list from the URL
    // when the list is blank, so a crypto market still ends up citing its one
    // source — the same source, reached the way the form reaches it.
    resolutionSources: (metadata.resolutionSources ?? []).join("\n"),
    resolutionTime: toDateTimeLocalValue(new Date(market.resolutionAt)),
    resolutionUrl: metadata.resolutionUrl ?? "",
  };
}
