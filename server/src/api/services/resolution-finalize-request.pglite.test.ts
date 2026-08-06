import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import type { runResolutionFinalizePass } from "src/keeper/resolution-finalize";
import { createPgliteDb } from "src/test-support/pglite-db";

import { requestResolutionFinalization } from "./resolution-finalize-request";

const GRADUATED_MARKET_ID = 41n;
const PREGRAD_MARKET_ID = 42n;
const MISSING_MARKET_ID = 43n;
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000f1";
const METADATA_HASH = `0x${"5a".repeat(32)}`;
const CREATOR = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const TRANSACTION_HASH = `0x${"5b".repeat(32)}`;
const SETTLE_HASH = `0x${"5c".repeat(32)}` as const;
const AT = new Date("2026-07-01T12:00:00.000Z");

let chainId: number;
let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

/**
 * A stand-in for the keeper's finalize pass. The pass itself is covered by
 * `src/keeper/resolution-finalize.test.ts`; what matters here is that this
 * service reuses it and maps every outcome onto the caller-facing result.
 */
function finalizeReturning(
  outcome: Awaited<ReturnType<typeof runResolutionFinalizePass>>,
) {
  const calls: unknown[] = [];

  return {
    calls,
    finalize: (async (args: unknown) => {
      calls.push(args);
      return outcome;
    }) as unknown as typeof runResolutionFinalizePass,
  };
}

beforeAll(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);

  const { config } = await import("src/config");
  chainId = config.chainId;

  const [contract] = await dbc
    .insert(schema.contracts)
    .values({
      address: "0x00000000000000000000000000000000000000cc",
      chainId,
      name: "PregradManager",
    })
    .returning({ id: schema.contracts.id });

  if (!contract) {
    throw new Error("Failed to seed the contract row");
  }

  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId,
    createdAt: AT,
    description: "Settle-request market.",
    metadataCreatedAt: AT.toISOString(),
    metadataHash: METADATA_HASH,
    question: "Will the stuck proposal settle?",
    resolutionCriteria: "Resolves YES when the event is confirmed.",
    updatedAt: AT,
  });

  for (const marketId of [GRADUATED_MARKET_ID, PREGRAD_MARKET_ID]) {
    await dbc.insert(schema.markets).values({
      bypassAiResolution: false,
      chainId,
      collateral: COLLATERAL,
      contractId: contract.id,
      createdAt: AT,
      createdBlockNumber: 50n + marketId,
      createdBlockTimestamp: AT,
      createdLogIndex: Number(marketId),
      createdTransactionHash: TRANSACTION_HASH,
      creator: CREATOR,
      graduationThreshold: 2_500n * 10n ** 18n,
      graduationTime: AT,
      liquidityParameter: 5_000n * 10n ** 18n,
      marketId,
      metadataHash: METADATA_HASH,
      noShares: 0n,
      openingProbabilityWad: 500_000_000_000_000_000n,
      receiptCount: 0n,
      resolutionTime: AT,
      status:
        marketId === GRADUATED_MARKET_ID ? "resolution_pending" : "bootstrap",
      totalEscrowed: 0n,
      updatedAt: AT,
      yesNotBefore: null,
      yesShares: 0n,
    });
  }

  // Only the graduated market has a postgrad venue; the pregrad one is what
  // proves the endpoint distinguishes "never graduated" from "not found".
  await dbc.insert(schema.graduationFinalizedEvents).values({
    blockNumber: 90n,
    blockTimestamp: AT,
    chainId,
    completeSetCount: 2_500n * 10n ** 18n,
    contractId: contract.id,
    logIndex: 1,
    marketId: GRADUATED_MARKET_ID,
    postgradAdapter: "0x00000000000000000000000000000000000000f2",
    postgradMarket: POSTGRAD_MARKET,
    refundTotal: 0n,
    retainedCostTotal: 0n,
    transactionHash: TRANSACTION_HASH,
  });
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

describe("requestResolutionFinalization", () => {
  it.each([
    ["a non-integer chain", Number.NaN, "41", "Invalid chain id."],
    ["a zero chain", 0, "41", "Invalid chain id."],
    ["a non-numeric market id", 31337, "not-a-number", "Invalid market id."],
  ])(
    "rejects %s without touching the chain",
    async (_label, chain, market, message) => {
      const { calls, finalize } = finalizeReturning({
        kind: "finalized",
        transactionHash: SETTLE_HASH,
      });

      const result = await requestResolutionFinalization(
        { chainId: chain, marketId: market },
        { finalize },
      );

      expect(result).toEqual({ kind: "invalid_market_id", message });
      expect(calls).toHaveLength(0);
    },
  );

  it("reports a market that does not exist", async () => {
    const { calls, finalize } = finalizeReturning({
      kind: "finalized",
      transactionHash: SETTLE_HASH,
    });

    const result = await requestResolutionFinalization(
      { chainId, marketId: MISSING_MARKET_ID.toString() },
      { finalize },
    );

    expect(result.kind).toBe("not_found");
    expect(calls).toHaveLength(0);
  });

  // The graduation projection supplies the postgrad address, so a market it
  // never recorded is invisible here — the one gap this endpoint cannot close.
  it("separates a market that never graduated from one that is missing", async () => {
    const { calls, finalize } = finalizeReturning({
      kind: "finalized",
      transactionHash: SETTLE_HASH,
    });

    const result = await requestResolutionFinalization(
      { chainId, marketId: PREGRAD_MARKET_ID.toString() },
      { finalize },
    );

    expect(result.kind).toBe("not_graduated");
    expect(calls).toHaveLength(0);
  });

  it("settles the market through the keeper's own finalize pass", async () => {
    const { calls, finalize } = finalizeReturning({
      kind: "finalized",
      transactionHash: SETTLE_HASH,
    });

    const result = await requestResolutionFinalization(
      { chainId, marketId: GRADUATED_MARKET_ID.toString() },
      { finalize },
    );

    expect(result).toEqual({
      kind: "settled",
      message: "Market settled to its proposed outcome.",
      transactionHash: SETTLE_HASH,
    });
    // The address comes from the graduation projection, not the caller.
    expect(calls[0]).toMatchObject({
      market: {
        chainId,
        marketId: GRADUATED_MARKET_ID,
        postgradMarket: POSTGRAD_MARKET,
      },
    });
  });

  it.each([
    [
      "window_open",
      "Dispute window is still open; the proposal cannot be settled yet.",
    ],
    [
      "disputed",
      "Resolution is disputed, so it cannot be settled here; an operator settles a disputed market.",
    ],
    ["already_resolved", "Market is already settled."],
    ["no_pending_proposal", "Market has no proposed resolution to settle."],
  ] as const)(
    "reports the %s skip as an ordinary refusal",
    async (reason, message) => {
      const { finalize } = finalizeReturning({ kind: "skipped", reason });

      const result = await requestResolutionFinalization(
        { chainId, marketId: GRADUATED_MARKET_ID.toString() },
        { finalize },
      );

      expect(result).toEqual({ kind: reason, message });
    },
  );
});
