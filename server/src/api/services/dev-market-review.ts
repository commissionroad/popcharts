import type { Hash } from "viem";

import type {
  DevMarketReviewIneligibleReason,
  MarketResponse,
} from "src/api/models/markets";
import { transitionReviewedMarketOnChain } from "src/ai-review-runner/chain-review";
import { marketStatusForReviewVerdict } from "src/ai-review-runner/jobs";
import { DEFAULT_SCORES } from "src/ai-review/scoring";
import type {
  ReviewResult,
  ReviewScoreRationales,
  ReviewVerdict,
} from "src/ai-review/types";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { calculateMatchedMarketCap } from "./matched-market-cap";
import { serializeMarketRow } from "./markets";

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketReviewRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type ForcedReviewPersistence = {
  chainId: number;
  marketId: bigint;
  metadataHash: string;
  result: ReviewResult;
  reviewedAt: Date;
};

type ChainTransitionResult = Awaited<
  ReturnType<typeof transitionReviewedMarketOnChain>
>;

export type DevMarketReviewResult =
  | {
      kind: "reviewed";
      market: MarketResponse;
      transactionHash?: Hash;
      verdict: ReviewVerdict;
    }
  | {
      kind: "dev_disabled";
      message: string;
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: DevMarketReviewIneligibleReason;
    }
  | {
      kind: "invalid_market_id";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    };

export type DevMarketReviewDependencies = {
  devReviewEnabled: () => boolean;
  persistForcedReview: (input: ForcedReviewPersistence) => Promise<void>;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<DevMarketReviewRow | null>;
  transitionOnChain: typeof transitionReviewedMarketOnChain;
};

/**
 * Dev-only review harness that records a deterministic review result without
 * invoking the AI review service or runner.
 */
export async function forceMarketReview(
  {
    chainId,
    marketId,
    reasons,
    verdict,
  }: {
    chainId: number;
    marketId: string;
    reasons?: string[];
    verdict: ReviewVerdict;
  },
  dependencies: DevMarketReviewDependencies = defaultDevMarketReviewDependencies,
): Promise<DevMarketReviewResult> {
  if (!dependencies.devReviewEnabled()) {
    return {
      kind: "dev_disabled",
      message: "Dev market review is disabled.",
    };
  }

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      kind: "invalid_market_id",
      message: "Invalid chain id.",
    };
  }

  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return {
      kind: "invalid_market_id",
      message: "Invalid market id.",
    };
  }

  const row = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!row) {
    return {
      kind: "not_found",
      message: "Market not found.",
    };
  }

  const market = serializeReviewMarketRow(row);

  if (row.market.status !== "under_review") {
    return {
      kind: "ineligible",
      market,
      message: `Market is ${row.market.status}; only under-review markets can be force-reviewed.`,
      reason: "wrong_status",
    };
  }

  const result = buildForcedReviewResult(verdict, reasons);
  const targetMarketStatus = marketStatusForReviewVerdict(verdict);
  let chainTransition: ChainTransitionResult = null;

  if (targetMarketStatus) {
    try {
      chainTransition = await dependencies.transitionOnChain({
        chainId,
        marketId: parsedMarketId,
        targetMarketStatus,
      });
    } catch (error) {
      return {
        kind: "ineligible",
        market,
        message:
          error instanceof Error
            ? error.message
            : "Market is not under review on-chain.",
        reason: "chain_status",
      };
    }
  }

  await dependencies.persistForcedReview({
    chainId,
    marketId: parsedMarketId,
    metadataHash: row.market.metadataHash,
    result,
    reviewedAt: new Date(),
  });

  return {
    kind: "reviewed",
    market,
    ...(chainTransition?.transactionHash
      ? { transactionHash: chainTransition.transactionHash }
      : {}),
    verdict,
  };
}

const defaultDevMarketReviewDependencies: DevMarketReviewDependencies = {
  devReviewEnabled: () => config.devToolsEnabled && config.name === "local",
  persistForcedReview,
  selectMarket: selectMarketForDevReview,
  transitionOnChain: transitionReviewedMarketOnChain,
};

function buildForcedReviewResult(
  verdict: ReviewVerdict,
  reasons?: string[],
): ReviewResult {
  return {
    evidence: [],
    hardFlags: [],
    modelId: undefined,
    promptVersion: "dev-force-review",
    provider: "heuristic",
    reasons: reasons ?? [defaultReasonForVerdict(verdict)],
    scoreRationales: DEV_SCORE_RATIONALES,
    scores: DEFAULT_SCORES,
    sourceChecks: [],
    verdict,
  };
}

function defaultReasonForVerdict(verdict: ReviewVerdict) {
  if (verdict === "approve") {
    return "Approved by the dev review harness.";
  }

  if (verdict === "reject") {
    return "This market was rejected by the dev review harness.";
  }

  return "Parked for manual review by the dev harness.";
}

const DEV_SCORE_RATIONALE = "Set by the dev force-review harness.";
const DEV_SCORE_RATIONALES: ReviewScoreRationales = {
  contentSafety: DEV_SCORE_RATIONALE,
  corroboration: DEV_SCORE_RATIONALE,
  disputeRisk: DEV_SCORE_RATIONALE,
  objectivity: DEV_SCORE_RATIONALE,
  promptInjectionRisk: DEV_SCORE_RATIONALE,
  publicKnowability: DEV_SCORE_RATIONALE,
  sourceQuality: DEV_SCORE_RATIONALE,
};

async function persistForcedReview({
  chainId,
  marketId,
  metadataHash,
  result,
  reviewedAt,
}: ForcedReviewPersistence) {
  await db.insert(schema.marketAiReviews).values({
    chainId,
    evidence: result.evidence,
    hardFlags: result.hardFlags,
    marketId,
    metadataHash,
    modelId: result.modelId ?? null,
    promptVersion: result.promptVersion,
    provider: result.provider,
    reasons: result.reasons,
    reviewedAt,
    scoreRationales: result.scoreRationales,
    scores: result.scores,
    sourceChecks: result.sourceChecks,
    verdict: result.verdict,
  });
}

async function selectMarketForDevReview({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<DevMarketReviewRow | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .leftJoin(schema.marketMetadata, marketMetadataJoinCondition())
    .where(
      and(
        eq(
          schema.contracts.address,
          config.contracts.pregradManager.toLowerCase(),
        ),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function serializeReviewMarketRow(row: DevMarketReviewRow) {
  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
  );
}

function marketMetadataJoinCondition() {
  return and(
    eq(schema.marketMetadata.chainId, schema.markets.chainId),
    eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
  );
}

function marketContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.markets.contractId),
    eq(schema.contracts.chainId, schema.markets.chainId),
  );
}
