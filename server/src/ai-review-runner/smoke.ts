import { and, closeDb, db, eq, schema } from "src/db/client";
import {
  claimReviewJobs,
  enqueueEligibleMarketReviewJobs,
  processReviewJob,
} from "./jobs";
import type { AiReviewRunnerConfig } from "./config";

const DEFAULT_SMOKE_PORT = "3012";
const SMOKE_CHAIN_ID = 31337;
const SMOKE_CONTRACT_ADDRESS = "0x000000000000000000000000000000000000cafe";
const SMOKE_CREATOR_ADDRESS = "0x0000000000000000000000000000000000000001";
const SMOKE_JOB_PRIORITY = 2_147_483_647;

process.env.AI_REVIEW_PROVIDER ??= "heuristic";
process.env.AI_REVIEW_INTERNET_ACCESS ??= "off";
process.env.AI_REVIEW_FETCH_SEARCH_RESULTS ??= "false";
process.env.AI_REVIEW_PORT ??=
  process.env.AI_REVIEW_SMOKE_PORT ?? DEFAULT_SMOKE_PORT;

type AiReviewServerModule = typeof import("src/ai-review/server");

async function main() {
  let serverModule: AiReviewServerModule | null = null;
  let serviceStarted = false;

  try {
    const market = await seedUnderReviewMarket();

    serverModule = await import("src/ai-review/server");
    const serviceUrl = startAiReviewService(serverModule);
    serviceStarted = true;

    const config = buildSmokeRunnerConfig(serviceUrl);

    const enqueued = await enqueueEligibleMarketReviewJobs({
      limit: 1,
      maxAttempts: config.maxAttempts,
    });

    const smokeJob = enqueued.find(
      (job) =>
        job.chainId === market.chainId &&
        job.marketId === market.marketId &&
        job.metadataHash === market.metadataHash,
    );
    if (!smokeJob) {
      throw new Error(
        `Expected to enqueue the smoke market review job, enqueued ${enqueued.length}.`,
      );
    }

    await db
      .update(schema.marketAiReviewJobs)
      .set({
        priority: SMOKE_JOB_PRIORITY,
        requestedProvider: "heuristic",
        runAfter: new Date(0),
        updatedAt: new Date(),
      })
      .where(eq(schema.marketAiReviewJobs.id, smokeJob.id));

    const claimed = await claimReviewJobs({ config });
    const claimedJob = claimed[0];
    if (claimed.length !== 1 || !claimedJob) {
      throw new Error(
        `Expected to claim exactly one AI review job, claimed ${claimed.length}.`,
      );
    }
    if (claimedJob.job.id !== smokeJob.id) {
      throw new Error(
        `Expected to claim smoke job ${smokeJob.id}, claimed ${claimedJob.job.id}.`,
      );
    }

    const outcome = await processReviewJob({
      claimed: claimedJob,
      config,
    });
    if (outcome.status !== "succeeded") {
      throw new Error(`AI review smoke job ${outcome.status}.`);
    }
    if (outcome.review.verdict !== "approve") {
      throw new Error(
        `Expected heuristic smoke review to approve, got ${outcome.review.verdict}.`,
      );
    }

    const [updatedMarket] = await db
      .select()
      .from(schema.markets)
      .where(
        and(
          eq(schema.markets.chainId, market.chainId),
          eq(schema.markets.marketId, market.marketId),
        ),
      )
      .limit(1);

    if (updatedMarket?.status !== "bootstrap") {
      throw new Error(
        `Expected reviewed smoke market to transition to bootstrap, got ${updatedMarket?.status ?? "missing"}.`,
      );
    }

    console.info("[AI Review Runner Smoke] passed", {
      enqueuedJobs: enqueued.length,
      jobId: outcome.job.id,
      marketId: market.marketId.toString(),
      metadataHash: market.metadataHash,
      reviewId: outcome.review.id,
      status: updatedMarket?.status,
      verdict: outcome.review.verdict,
    });
  } finally {
    if (serviceStarted) {
      await serverModule?.aiReviewApp.stop();
    }
    await closeDb();
  }
}

function startAiReviewService({
  aiReviewApp,
  buildAiReviewRuntimeStatus,
}: AiReviewServerModule) {
  const runtimeStatus = buildAiReviewRuntimeStatus();
  if (!runtimeStatus.ready) {
    throw new Error(
      `AI Review service provider ${runtimeStatus.activeProvider} is not ready.`,
    );
  }

  const configuredPort = Number.parseInt(
    process.env.AI_REVIEW_PORT ?? DEFAULT_SMOKE_PORT,
    10,
  );
  aiReviewApp.listen(configuredPort);
  const port = aiReviewApp.server?.port ?? configuredPort;
  const serviceUrl = `http://127.0.0.1:${port}`;

  console.info("[AI Review Runner Smoke] review service started", {
    provider: runtimeStatus.activeProvider,
    serviceUrl,
  });

  return serviceUrl;
}

function buildSmokeRunnerConfig(serviceUrl: string): AiReviewRunnerConfig {
  return {
    backoffMs: 1_000,
    batchSize: 1,
    leaseMs: 30_000,
    maxAttempts: 2,
    pollMs: 500,
    requestTimeoutMs: 8_000,
    runnerId: `ai-review-smoke-${process.pid}`,
    serviceUrl,
  };
}

async function seedUnderReviewMarket() {
  const now = new Date();
  const smokeCreatedAt = new Date(0);
  const seed = BigInt(Date.now());
  const marketId = 9_000_000_000_000n + seed;
  const metadataHash = makeBytes32("metadata", seed);

  // Remove only prior smoke-owned rows so production claim ordering cannot
  // accidentally process an older local fixture instead of this one.
  await deletePriorSmokeRows();

  const [contract] = await db
    .insert(schema.contracts)
    .values({
      address: SMOKE_CONTRACT_ADDRESS,
      chainId: SMOKE_CHAIN_ID,
      name: "AiReviewSmokePregradManager",
    })
    .onConflictDoUpdate({
      target: [schema.contracts.address, schema.contracts.chainId],
      set: {
        name: "AiReviewSmokePregradManager",
      },
    })
    .returning();

  if (!contract) {
    throw new Error("Failed to upsert AI review smoke contract row.");
  }

  await db.insert(schema.marketMetadata).values({
    category: "Science",
    chainId: SMOKE_CHAIN_ID,
    createdAt: smokeCreatedAt,
    description:
      "Resolve using public NASA announcements or major wire coverage.",
    metadataCreatedAt: now.toISOString(),
    metadataHash,
    question: "Will NASA announce a new Artemis launch date in 2026?",
    resolutionCriteria:
      "YES if NASA publishes an official new Artemis launch date before the end of 2026. NO otherwise.",
    resolutionSources: ["Official NASA announcements", "Major wire coverage"],
    resolutionUrl: "https://www.nasa.gov/",
    updatedAt: now,
  });

  const [market] = await db
    .insert(schema.markets)
    .values({
      bypassAiResolution: false,
      chainId: SMOKE_CHAIN_ID,
      collateral: "0x0000000000000000000000000000000000000000",
      contractId: contract.id,
      createdBlockNumber: seed,
      createdBlockTimestamp: now,
      createdAt: smokeCreatedAt,
      createdLogIndex: Number(seed % 1_000_000n),
      createdTransactionHash: makeBytes32("tx", seed),
      creator: SMOKE_CREATOR_ADDRESS,
      graduationThreshold: 1_000_000_000_000_000_000n,
      graduationTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      liquidityParameter: 1_000_000_000_000_000_000n,
      marketId,
      metadataHash,
      metadataUri: "ipfs://popcharts/ai-review-runner-smoke",
      openingProbabilityWad: 500_000_000_000_000_000n,
      resolutionTime: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      status: "under_review",
      updatedAt: now,
    })
    .returning();

  if (!market) {
    throw new Error("Failed to insert AI review smoke market row.");
  }

  return market;
}

async function deletePriorSmokeRows() {
  const rows = await db
    .select({
      chainId: schema.markets.chainId,
      marketId: schema.markets.marketId,
      metadataHash: schema.markets.metadataHash,
    })
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.chainId, SMOKE_CHAIN_ID),
        eq(schema.markets.creator, SMOKE_CREATOR_ADDRESS),
      ),
    );

  for (const row of rows) {
    const marketKey = and(
      eq(schema.marketAiReviewJobs.chainId, row.chainId),
      eq(schema.marketAiReviewJobs.marketId, row.marketId),
      eq(schema.marketAiReviewJobs.metadataHash, row.metadataHash),
    );

    await db.delete(schema.marketAiReviewJobs).where(marketKey);
    await db
      .delete(schema.marketAiReviews)
      .where(
        and(
          eq(schema.marketAiReviews.chainId, row.chainId),
          eq(schema.marketAiReviews.marketId, row.marketId),
          eq(schema.marketAiReviews.metadataHash, row.metadataHash),
        ),
      );
    await db
      .delete(schema.markets)
      .where(
        and(
          eq(schema.markets.chainId, row.chainId),
          eq(schema.markets.marketId, row.marketId),
          eq(schema.markets.metadataHash, row.metadataHash),
        ),
      );
    await db
      .delete(schema.marketMetadata)
      .where(
        and(
          eq(schema.marketMetadata.chainId, row.chainId),
          eq(schema.marketMetadata.metadataHash, row.metadataHash),
        ),
      );
  }
}

function makeBytes32(label: string, seed: bigint) {
  const encoded = `${Buffer.from(label).toString("hex")}${seed.toString(16)}`;
  return `0x${encoded.padEnd(64, "0").slice(0, 64)}`;
}

if (import.meta.main) {
  main().catch((error) => {
    if (looksLikeConnectionRefused(error)) {
      console.error(
        [
          "[AI Review Runner Smoke] failed: local Postgres is not reachable.",
          "Start the local database on the configured DATABASE_URL, then rerun the smoke command.",
          "The default server DATABASE_URL expects PostgreSQL at localhost:5433.",
        ].join("\n"),
      );
    } else {
      console.error("[AI Review Runner Smoke] failed", error);
    }

    process.exitCode = 1;
  });
}

function looksLikeConnectionRefused(error: unknown) {
  if (typeof error === "object" && error !== null) {
    if ((error as { code?: unknown }).code === "ECONNREFUSED") {
      return true;
    }

    const nested = (error as { errors?: unknown }).errors;
    if (Array.isArray(nested) && nested.some(looksLikeConnectionRefused)) {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return message.includes("ECONNREFUSED");
}
