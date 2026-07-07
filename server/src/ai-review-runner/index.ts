import {
  claimReviewJobs,
  enqueueEligibleMarketReviewJobs,
  processReviewJob,
} from "./jobs";
import { getAiReviewRunnerConfig, type AiReviewRunnerConfig } from "./config";

let stopRequested = false;

/**
 * Long-running worker loop for AI review jobs.
 *
 * Each pass reconciles durable DB state: discover eligible under-review markets,
 * lease due jobs, and process whatever was claimed. The loop sleeps when there
 * is no work, so missed notifications or crashed processes can recover from the
 * database alone.
 */
export async function runAiReviewRunner(
  config: AiReviewRunnerConfig = getAiReviewRunnerConfig(),
) {
  console.info("[AI Review Runner] started", {
    batchSize: config.batchSize,
    runnerId: config.runnerId,
    serviceUrl: config.serviceUrl,
  });

  while (!stopRequested) {
    // Discovery is intentionally DB-driven. The indexer only writes market
    // projections; the runner decides when an under-review market needs a job.
    const enqueued = await enqueueEligibleMarketReviewJobs({
      limit: config.batchSize,
      maxAttempts: config.maxAttempts,
    });
    if (enqueued.length > 0) {
      console.info("[AI Review Runner] enqueued jobs", {
        count: enqueued.length,
      });
    }

    // Claiming uses PostgreSQL leases, so multiple runner processes can run at
    // once without trusting process-local state or an in-memory queue.
    const claimed = await claimReviewJobs({ config });
    if (claimed.length === 0) {
      await sleep(config.pollMs);
      continue;
    }

    for (const job of claimed) {
      const outcome = await processReviewJob({ claimed: job, config });
      console.info("[AI Review Runner] processed job", {
        jobId: outcome.job.id,
        marketId: outcome.job.marketId.toString(),
        metadataHash: outcome.job.metadataHash,
        status: outcome.status,
      });
    }
  }

  console.info("[AI Review Runner] stopped", { runnerId: config.runnerId });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestStop(signal: NodeJS.Signals) {
  stopRequested = true;
  console.info("[AI Review Runner] shutdown requested", { signal });
}

// Bun sets import.meta.main when this file is executed directly. Keeping this
// guard lets tests import runAiReviewRunner without starting the worker loop.
if (import.meta.main) {
  // Use one-shot signal handlers so Ctrl-C or container termination asks the
  // loop to stop after the current job instead of abandoning a DB lease mid-run.
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  runAiReviewRunner().catch((error) => {
    console.error("[AI Review Runner] fatal error", error);
    process.exitCode = 1;
  });
}
