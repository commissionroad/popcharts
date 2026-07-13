import {
  getAiResolutionRunnerConfig,
  type AiResolutionRunnerConfig,
} from "./config";
import {
  claimResolutionJobs,
  enqueueEligibleMarketResolutionJobs,
  processResolutionJob,
} from "./jobs";

let stopRequested = false;

/**
 * Long-running worker loop for resolution jobs.
 *
 * Each pass reconciles durable DB state: discover graduated markets past their
 * resolution gate, lease due jobs, and process whatever was claimed. The loop
 * sleeps when there is no work, so missed notifications or crashed processes can
 * recover from the database alone.
 */
export async function runAiResolutionRunner(
  config: AiResolutionRunnerConfig = getAiResolutionRunnerConfig(),
) {
  console.info("[AI Resolution Runner] started", {
    batchSize: config.batchSize,
    runnerId: config.runnerId,
    serviceUrl: config.serviceUrl,
  });

  while (!stopRequested) {
    // Discovery is DB-driven: the indexer writes market projections, the runner
    // decides when a graduated market past its gate needs a resolution job.
    const enqueued = await enqueueEligibleMarketResolutionJobs({
      limit: config.batchSize,
      maxAttempts: config.maxAttempts,
    });
    if (enqueued.length > 0) {
      console.info("[AI Resolution Runner] enqueued jobs", {
        count: enqueued.length,
      });
    }

    // Claiming uses PostgreSQL leases, so multiple runner processes can run at
    // once without trusting process-local state or an in-memory queue.
    const claimed = await claimResolutionJobs({ config });
    if (claimed.length === 0) {
      await sleep(config.pollMs);
      continue;
    }

    for (const job of claimed) {
      const outcome = await processResolutionJob({ claimed: job, config });
      console.info("[AI Resolution Runner] processed job", {
        jobId: outcome.job.id,
        marketId: outcome.job.marketId.toString(),
        metadataHash: outcome.job.metadataHash,
        status: outcome.status,
      });
    }
  }

  console.info("[AI Resolution Runner] stopped", { runnerId: config.runnerId });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestStop(signal: NodeJS.Signals) {
  stopRequested = true;
  console.info("[AI Resolution Runner] shutdown requested", { signal });
}

// Bun sets import.meta.main when this file is executed directly. Keeping this
// guard lets tests import runAiResolutionRunner without starting the worker loop.
if (import.meta.main) {
  // One-shot handlers so Ctrl-C or container termination asks the loop to stop
  // after the current job instead of abandoning a DB lease mid-run.
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  runAiResolutionRunner().catch((error) => {
    console.error("[AI Resolution Runner] fatal error", error);
    process.exitCode = 1;
  });
}
