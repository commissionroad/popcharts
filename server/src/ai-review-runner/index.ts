import {
  claimReviewJobs,
  enqueueEligibleMarketReviewJobs,
  processReviewJob,
} from "./jobs";
import {
  getAiReviewRunnerConfig,
  type AiReviewRunnerConfig,
} from "./config";

let stopRequested = false;

export async function runAiReviewRunner(
  config: AiReviewRunnerConfig = getAiReviewRunnerConfig(),
) {
  console.info("[AI Review Runner] started", {
    batchSize: config.batchSize,
    runnerId: config.runnerId,
    serviceUrl: config.serviceUrl,
  });

  while (!stopRequested) {
    const enqueued = await enqueueEligibleMarketReviewJobs({
      limit: config.batchSize,
      maxAttempts: config.maxAttempts,
    });
    if (enqueued.length > 0) {
      console.info("[AI Review Runner] enqueued jobs", {
        count: enqueued.length,
      });
    }

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

if (import.meta.main) {
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  runAiReviewRunner().catch((error) => {
    console.error("[AI Review Runner] fatal error", error);
    process.exitCode = 1;
  });
}
