// Shared PGlite fixture for the resolution test suites (ADR 0026 review: the
// same ~34-line seed block had been pasted into four files; a column added to
// `markets` would have meant four hand-edits, three of them forgotten).
import type { db } from "src/db/client";
import * as schema from "src/db/schema";

export const RESOLUTION_FIXTURE = {
  chainId: 31337,
  marketId: 7n,
  metadataHash: `0x${"22".repeat(32)}`,
  postgradMarketAddress:
    "0x00000000000000000000000000000000000000ee" as `0x${string}`,
  question: "Does the shared resolution fixture seed one market?",
} as const;

/**
 * Seeds the one market every resolution suite needs — contract, metadata, and
 * a `markets` row in the given status — keyed by {@link RESOLUTION_FIXTURE}.
 * Call from `beforeEach` after `reset()`; PGlite truncates fixtures too.
 */
export async function seedResolutionMarket(
  dbc: typeof db,
  { status = "graduated" }: { status?: schema.MarketStatus } = {},
) {
  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: RESOLUTION_FIXTURE.chainId,
    name: "PregradManager",
  });
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: RESOLUTION_FIXTURE.chainId,
    description: "A graduated market used by the resolution suites.",
    metadataCreatedAt: "2026-07-01T00:00:00.000Z",
    metadataHash: RESOLUTION_FIXTURE.metadataHash,
    question: RESOLUTION_FIXTURE.question,
    resolutionCriteria: "Resolves YES when the fixture seeds cleanly.",
  });
  await dbc.insert(schema.markets).values({
    chainId: RESOLUTION_FIXTURE.chainId,
    collateral: "0x00000000000000000000000000000000000000dd",
    contractId: 1,
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-07-01T00:00:00.000Z"),
    createdLogIndex: 0,
    createdTransactionHash: `0x${"33".repeat(32)}`,
    creator: "0x00000000000000000000000000000000000000aa",
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-07-02T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: RESOLUTION_FIXTURE.marketId,
    metadataHash: RESOLUTION_FIXTURE.metadataHash,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-07-03T00:00:00.000Z"),
    status,
  });
}

/**
 * Insert values for one `market_resolutions` row against the fixture market.
 * Defaults to a confident anthropic `resolve_yes`; override what a test cares
 * about and leave the rest.
 */
export function resolutionRowValues(
  overrides: Partial<typeof schema.marketResolutions.$inferInsert> = {},
): typeof schema.marketResolutions.$inferInsert {
  return {
    chainId: RESOLUTION_FIXTURE.chainId,
    evidence: [],
    hardFlags: [],
    marketId: RESOLUTION_FIXTURE.marketId,
    metadataHash: RESOLUTION_FIXTURE.metadataHash,
    outcome: "yes",
    promptVersion: "v1",
    provider: "anthropic",
    reasons: ["Because."],
    sourceChecks: [],
    verdict: "resolve_yes",
    ...overrides,
  };
}
