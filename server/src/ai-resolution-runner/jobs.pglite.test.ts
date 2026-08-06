// Real-SQL tier for the stand-down path. The claim under test is a durability
// one — "the audit row exists after the job closes" — so it can only be settled
// by writing rows and reading them back. The pure decision functions live in
// jobs.test.ts; this file covers what those decisions actually persist.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { eq } from "drizzle-orm";

import type { ResolutionResult } from "src/ai-resolution/types";
import type { db as productionDb } from "src/db/client";
import { setDbForTesting } from "src/db/client";
import * as schema from "src/db/schema";
import { createPgliteDb } from "src/test-support/pglite-db";

import type { AiResolutionRunnerConfig } from "./config";
import {
  CHAIN_VERDICT_DIVERGENCE_HARD_FLAG,
  processResolutionJob,
  type ClaimedResolutionJob,
  type ResolutionJobDependencies,
} from "./jobs";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const METADATA_HASH = `0x${"22".repeat(32)}`;
const POSTGRAD_MARKET =
  "0x00000000000000000000000000000000000000ee" as `0x${string}`;
const NOW = new Date("2026-07-20T00:00:00.000Z");
const PROPOSED_AT = new Date("2026-07-19T00:00:00.000Z");

const CONFIG: AiResolutionRunnerConfig = {
  backoffMs: 30_000,
  batchSize: 5,
  corroborationEnabled: false,
  leaseMs: 1_200_000,
  maxAttempts: 5,
  pollMs: 1_000,
  requestTimeoutMs: 30_000,
  runnerId: "test-runner",
  serviceUrl: "http://127.0.0.1:3004",
};

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

/** A confident NO — deliberately the opposite of the YES standing on-chain. */
function modelResult(): ResolutionResult {
  return {
    confidence: 0.92,
    evidence: [],
    hardFlags: [],
    outcome: "no",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["Fresh evidence points the other way."],
    sourceChecks: [],
    verdict: "resolve_no",
  };
}

function makeDependencies(overrides: Partial<ResolutionJobDependencies> = {}): {
  calls: string[];
  dependencies: ResolutionJobDependencies;
} {
  const calls: string[] = [];

  return {
    calls,
    dependencies: {
      proposeMarketResolutionOnChain: async () => {
        // Standing down must never reach a write. Failing loudly here is the
        // point: a silent no-op would hide a regression that proposes twice.
        throw new Error("proposeMarketResolutionOnChain must not be called");
      },
      readOnChainResolutionProposal: async () => {
        calls.push("readOnChainResolutionProposal");
        return { blockTimestamp: PROPOSED_AT, proposedSide: "yes" };
      },
      resolveMarketWithService: async () => {
        calls.push("resolveMarketWithService");
        return modelResult();
      },
      ...overrides,
    },
  };
}

async function seedMarket(status: schema.MarketStatus) {
  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: CHAIN_ID,
    description: "A graduated market whose proposal was disputed.",
    metadataCreatedAt: PROPOSED_AT.toISOString(),
    metadataHash: METADATA_HASH,
    question: "Does the audit row survive a dispute?",
    resolutionCriteria: "Resolves YES when the row is written.",
  });
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: PROPOSED_AT,
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: "0x00000000000000000000000000000000000000aa",
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-07-01T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-07-10T00:00:00.000Z"),
    status,
  });
}

async function seedClaimedJob(
  status: schema.MarketStatus,
): Promise<ClaimedResolutionJob> {
  await seedMarket(status);

  const [job] = await dbc
    .insert(schema.marketResolutionJobs)
    .values({
      chainId: CHAIN_ID,
      lockedBy: CONFIG.runnerId,
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      status: "running",
    })
    .returning();
  const [market] = await dbc
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.marketId, MARKET_ID));
  const [metadata] = await dbc
    .select()
    .from(schema.marketMetadata)
    .where(eq(schema.marketMetadata.metadataHash, METADATA_HASH));

  if (!job || !market || !metadata) {
    throw new Error("Failed to seed the claimed resolution job");
  }

  return { job, market, metadata, postgradMarketAddress: POSTGRAD_MARKET };
}

async function readResolutions() {
  return await dbc.select().from(schema.marketResolutions);
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("processResolutionJob standing down from a disputed market", () => {
  // The reported defect, end to end: an attempt proposed on-chain, its audit
  // write failed, and a dispute landed before the retry. The old code cancelled
  // here and the reasoning was lost for good — at the exact moment an operator
  // was being asked to overrule it.
  it("writes the missing audit row before closing the job", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies();

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("cancelled");

    const resolutions = await readResolutions();
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      chainId: CHAIN_ID,
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      postgradMarketAddress: POSTGRAD_MARKET,
    });
  });

  it("records the side standing on-chain, not the re-run's own verdict", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies();

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [resolution] = await readResolutions();
    // The chain holds YES; this run concluded NO. The money followed YES.
    expect(resolution?.verdict).toBe("resolve_yes");
    expect(resolution?.outcome).toBe("no");
    expect(resolution?.hardFlags).toContain(CHAIN_VERDICT_DIVERGENCE_HARD_FLAG);
  });

  it("stamps the row with the chain's timestamp, not the wall clock", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies();

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [resolution] = await readResolutions();
    expect(resolution?.resolvedAt).toEqual(PROPOSED_AT);
  });

  it("closes the job as cancelled and points it at the row it wrote", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies();

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [resolution] = await readResolutions();
    const [job] = await dbc
      .select()
      .from(schema.marketResolutionJobs)
      .where(eq(schema.marketResolutionJobs.id, claimed.job.id));

    expect(job).toMatchObject({
      leaseUntil: null,
      lockedBy: null,
      resolutionId: resolution?.id,
      status: "cancelled",
    });
    expect(outcome).toMatchObject({ status: "cancelled" });
  });

  it("signals the change feed so the market page sees the decision", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies();

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const changes = await dbc.select().from(schema.changeFeed);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      chainId: CHAIN_ID,
      op: "insert",
      sourceTable: "market_resolutions",
    });
    expect(BigInt(changes[0]?.marketId ?? -1n)).toBe(MARKET_ID);
  });

  it("leaves a job retryable when the rescue itself fails", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { dependencies } = makeDependencies({
      resolveMarketWithService: async () => {
        throw new Error("resolution service is down");
      },
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    // Cancelling on a transient failure would throw away the last chance to
    // write the row; a retryable job keeps that chance alive.
    expect(outcome.status).toBe("retryable_failed");
    expect(await readResolutions()).toHaveLength(0);
  });
});

describe("processResolutionJob on a market whose proposal already stands", () => {
  // `resolution_pending` is an eligible status, so a retry runs the full path.
  // A re-run that abstains submits nothing — but the chain still holds the side
  // an earlier attempt proposed, and the row must not contradict it.
  it("reconciles even when the re-run submits nothing", async () => {
    const claimed = await seedClaimedJob("resolution_pending");
    const { calls, dependencies } = makeDependencies({
      resolveMarketWithService: async () => ({
        ...modelResult(),
        outcome: "abstain",
        verdict: "manual_review",
      }),
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("succeeded");

    const [resolution] = await readResolutions();
    expect(resolution?.verdict).toBe("resolve_yes");
    expect(resolution?.outcome).toBe("abstain");
    expect(resolution?.hardFlags).toContain(CHAIN_VERDICT_DIVERGENCE_HARD_FLAG);
    // Read, never proposed: makeDependencies throws if the write path is hit.
    expect(calls).toContain("readOnChainResolutionProposal");
  });

  it("leaves a graduated market's abstention alone when nothing is on-chain", async () => {
    const claimed = await seedClaimedJob("graduated");
    const { dependencies } = makeDependencies({
      readOnChainResolutionProposal: async () => null,
      resolveMarketWithService: async () => ({
        ...modelResult(),
        outcome: "abstain",
        verdict: "manual_review",
      }),
    });

    await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    const [resolution] = await readResolutions();
    expect(resolution?.verdict).toBe("manual_review");
    expect(resolution?.hardFlags).toEqual([]);
  });
});

describe("processResolutionJob standing down without work to record", () => {
  it("cancels a market that never carried a proposal, without calling the model", async () => {
    const claimed = await seedClaimedJob("cancelled");
    const { calls, dependencies } = makeDependencies();

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("cancelled");
    expect(await readResolutions()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  // The indexed status and the contract can disagree. When the chain holds no
  // proposal there is nothing to explain, and no model run to pay for.
  it("cancels without a row when the chain holds no proposal", async () => {
    const claimed = await seedClaimedJob("disputed");
    const { calls, dependencies } = makeDependencies({
      readOnChainResolutionProposal: async () => null,
    });

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("cancelled");
    expect(await readResolutions()).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("does not write a second row when one already exists", async () => {
    const claimed = await seedClaimedJob("disputed");
    await dbc.insert(schema.marketResolutions).values({
      chainId: CHAIN_ID,
      evidence: [],
      hardFlags: [],
      marketId: MARKET_ID,
      metadataHash: METADATA_HASH,
      outcome: "yes",
      promptVersion: "v1",
      provider: "anthropic",
      reasons: ["Already recorded."],
      sourceChecks: [],
      verdict: "resolve_yes",
    });
    const { calls, dependencies } = makeDependencies();

    const outcome = await processResolutionJob({
      claimed,
      config: CONFIG,
      dependencies,
      now: NOW,
    });

    expect(outcome.status).toBe("cancelled");
    expect(await readResolutions()).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});
