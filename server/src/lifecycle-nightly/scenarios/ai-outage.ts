import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus } from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import { startService, stopService } from "../stack-control";
import { waitForCondition } from "../wait";
import type { Scenario } from "../report";

/**
 * ADR 0014 infrastructure drill: an AI service outage with runner retries,
 * lifecycle still completes. Stop the review service, create a market whose
 * review the runner cannot reach (connection refused), watch the review job
 * record a failed attempt and back off, then bring the service back — the
 * runner's next retry (or a freshly enqueued job) succeeds and the market
 * advances to bootstrap on its own.
 *
 * Recovery is asserted off MARKET STATUS and the review audit row, never off
 * the job status: during a long outage the job can reach `terminal_failed`
 * after its attempts are exhausted, yet the market still recovers because the
 * enqueue sweep spawns a fresh job once the service returns.
 */
export const aiOutage: Scenario = {
  name: "ai-outage",
  run: async ({ step }) => {
    await step("take the AI review service down", () =>
      stopService("ai-review"),
    );

    const market = await step("create market during the outage", () =>
      createLifecycleMarket({
        question: `Will the AI-outage lifecycle market recover once review returns? (run ${Date.now()})`,
        graduationSeconds: 600,
        resolutionSeconds: 700,
      }),
    );

    await step("the review runner retries and records a failure", () =>
      // The runner enqueues a job once the market is indexed, attempts the
      // down service, and marks the attempt failed with backoff. Keying off
      // lastError proves a real attempt was made against the outage.
      waitForCondition(
        `review job for market ${market.marketId} records a failed attempt`,
        async () => {
          const [job] = await db
            .select()
            .from(schema.marketAiReviewJobs)
            .where(
              and(
                eq(schema.marketAiReviewJobs.chainId, config.chainId),
                eq(schema.marketAiReviewJobs.marketId, market.marketId),
              ),
            )
            .limit(1);
          return job && job.attemptCount >= 1 && job.lastError !== null
            ? job
            : null;
        },
        { tickChain: true, timeoutMs: 120_000 },
      ),
    );

    await step("bring the AI review service back", () =>
      startService("ai-review"),
    );

    await step("the market recovers to bootstrap on its own", () =>
      // Budget covers the retry backoff (~30s) plus the review call, the
      // on-chain approval, and re-indexing.
      waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 180_000 }),
    );

    await step("a real review verdict was recorded", async () => {
      const [review] = await db
        .select()
        .from(schema.marketAiReviews)
        .where(
          and(
            eq(schema.marketAiReviews.chainId, config.chainId),
            eq(schema.marketAiReviews.marketId, market.marketId),
          ),
        )
        .limit(1);
      const row = assertTruthy("review audit row after recovery", review);
      assertEqual("recovered review verdict", row.verdict, "approve");
    });

    await step("paper trail shows no collateral movement", () =>
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      }),
    );
  },
};
