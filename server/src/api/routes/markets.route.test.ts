import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

const MARKET_ID = 77n;
// Post-graduation terminal-state fixtures (ADR 0018). They share the seeded
// contract row (the read paths pin contracts.chainId to config.chainId) and
// carry OLDER created timestamps than the primary market so the list's
// newest-first ordering keeps the original exact-serialization expectations
// stable at the head of the response.
const DRAW_MARKET_ID = 78n;
const RESOLVED_MARKET_ID = 79n;
const PREGRAD_CANCELLED_MARKET_ID = 80n;
const POSTGRAD_ADAPTER = "0x00000000000000000000000000000000000000cd";
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000ce";
const TERMINAL_CREATED_AT = new Date("2026-07-13T12:00:00.000Z");
const GRADUATED_AT = new Date("2026-07-14T13:00:00.000Z");
const SETTLED_AT = new Date("2026-07-14T14:00:00.000Z");
const GRADUATION_TRANSACTION_HASH = `0x${"77".repeat(32)}`;
const SETTLEMENT_TRANSACTION_HASH = `0x${"88".repeat(32)}`;
const METADATA_HASH = `0x${"22".repeat(32)}`;
const CREATOR = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const CREATED_AT = new Date("2026-07-14T12:00:00.000Z");
const CREATED_BLOCK_TIMESTAMP = new Date("2026-07-14T11:59:00.000Z");
const GRADUATION_TIME = new Date("2026-08-01T00:00:00.000Z");
const RESOLUTION_TIME = new Date("2026-09-01T00:00:00.000Z");
const TRANSACTION_HASH = `0x${"33".repeat(32)}`;

let app: (typeof import("src/api"))["app"];
let chainId: number;
let dbc: typeof productionDb;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);

  const { config } = await import("src/config");
  chainId = config.chainId;

  const [contract] = await dbc
    .insert(schema.contracts)
    .values({
      address: config.contracts.pregradManager.toLowerCase(),
      chainId,
      name: "PregradManager",
    })
    .returning({ id: schema.contracts.id });

  if (!contract) {
    throw new Error("Failed to seed the contract row");
  }

  await dbc.insert(schema.marketMetadata).values({
    category: "Science",
    chainId,
    createdAt: CREATED_AT,
    description: "A seeded route-layer market.",
    metadataCreatedAt: "2026-07-14T10:00:00.000Z",
    metadataHash: METADATA_HASH,
    outcomeNo: "No",
    outcomeYes: "Yes",
    question: "Will the seeded measurement exceed 42?",
    resolutionCriteria: "Resolve YES if the published measurement exceeds 42.",
    resolutionSources: ["https://example.com/measurement"],
    resolutionUrl: "https://example.com/measurement",
    updatedAt: CREATED_AT,
  });
  await dbc.insert(schema.markets).values({
    bypassAiResolution: true,
    chainId,
    collateral: COLLATERAL,
    contractId: contract.id,
    createdAt: CREATED_AT,
    createdBlockNumber: 9_223_372_036_854_775_000n,
    createdBlockTimestamp: CREATED_BLOCK_TIMESTAMP,
    createdLogIndex: 4,
    createdTransactionHash: TRANSACTION_HASH,
    creator: CREATOR,
    graduationThreshold: 123_456_789_012_345_678_901_234_567_890n,
    graduationTime: GRADUATION_TIME,
    liquidityParameter: 98_765_432_109_876_543_210_987_654_321n,
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    noShares: 44_444_444_444_444_444_444_444n,
    openingProbabilityWad: 555_000_000_000_000_000n,
    receiptCount: 12_345_678_901_234_567_890n,
    resolutionTime: RESOLUTION_TIME,
    status: "bootstrap",
    totalEscrowed: 66_666_666_666_666_666_666_666n,
    updatedAt: CREATED_AT,
    yesShares: 55_555_555_555_555_555_555_555n,
  });

  // Terminal-state fixtures: a postgrad draw (cancelled with venue history),
  // a resolved market, and a pregrad admin-cancel (no graduation row).
  const terminalMarkets = [
    { marketId: DRAW_MARKET_ID, status: "cancelled" as const },
    { marketId: RESOLVED_MARKET_ID, status: "resolved" as const },
    { marketId: PREGRAD_CANCELLED_MARKET_ID, status: "cancelled" as const },
  ];
  for (const [index, terminal] of terminalMarkets.entries()) {
    await dbc.insert(schema.markets).values({
      bypassAiResolution: true,
      chainId,
      collateral: COLLATERAL,
      contractId: contract.id,
      createdAt: TERMINAL_CREATED_AT,
      createdBlockNumber: 9_223_372_036_854_775_000n,
      createdBlockTimestamp: TERMINAL_CREATED_AT,
      createdLogIndex: index,
      createdTransactionHash: `0x${"66".repeat(31)}0${index}`,
      creator: CREATOR,
      graduationThreshold: 123_456_789_012_345_678_901_234_567_890n,
      graduationTime: GRADUATION_TIME,
      liquidityParameter: 98_765_432_109_876_543_210_987_654_321n,
      marketId: terminal.marketId,
      metadataHash: METADATA_HASH,
      noShares: 44_444_444_444_444_444_444_444n,
      openingProbabilityWad: 555_000_000_000_000_000n,
      receiptCount: 12_345_678_901_234_567_890n,
      resolutionTime: RESOLUTION_TIME,
      status: terminal.status,
      totalEscrowed: 66_666_666_666_666_666_666_666n,
      updatedAt: TERMINAL_CREATED_AT,
      yesShares: 55_555_555_555_555_555_555_555n,
    });
  }

  for (const [index, marketId] of [
    DRAW_MARKET_ID,
    RESOLVED_MARKET_ID,
  ].entries()) {
    await dbc.insert(schema.graduationFinalizedEvents).values({
      blockNumber: 9_223_372_036_854_775_100n,
      blockTimestamp: GRADUATED_AT,
      chainId,
      completeSetCount: 2_500n * 10n ** 18n,
      contractId: contract.id,
      logIndex: index,
      marketId,
      postgradAdapter: POSTGRAD_ADAPTER,
      postgradMarket: POSTGRAD_MARKET,
      refundTotal: 100n * 10n ** 18n,
      retainedCostTotal: 2_400n * 10n ** 18n,
      transactionHash: GRADUATION_TRANSACTION_HASH,
    });
  }

  await dbc.insert(schema.postgradResolutionEvents).values({
    blockNumber: 9_223_372_036_854_775_200n,
    blockTimestamp: SETTLED_AT,
    chainId,
    contractId: contract.id,
    kind: "cancelled",
    logIndex: 0,
    marketId: DRAW_MARKET_ID,
    postgradMarket: POSTGRAD_MARKET,
    transactionHash: SETTLEMENT_TRANSACTION_HASH,
    winningSide: null,
  });
  await dbc.insert(schema.postgradResolutionEvents).values({
    blockNumber: 9_223_372_036_854_775_200n,
    blockTimestamp: SETTLED_AT,
    chainId,
    contractId: contract.id,
    kind: "resolved",
    logIndex: 1,
    marketId: RESOLVED_MARKET_ID,
    postgradMarket: POSTGRAD_MARKET,
    transactionHash: SETTLEMENT_TRANSACTION_HASH,
    winningSide: "yes",
  });

  ({ app } = await import("src/api"));
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

function expectedMarket() {
  return {
    bypassAiResolution: true,
    chainId,
    collateral: COLLATERAL,
    createdAt: CREATED_AT.toISOString(),
    createdBlockNumber: "9223372036854775000",
    createdBlockTimestamp: CREATED_BLOCK_TIMESTAMP.toISOString(),
    createdLogIndex: 4,
    createdTransactionHash: TRANSACTION_HASH,
    creator: CREATOR,
    graduationThreshold: "123456789012345678901234567890",
    graduationTime: GRADUATION_TIME.toISOString(),
    liquidityParameter: "98765432109876543210987654321",
    marketId: MARKET_ID.toString(),
    matchedMarketCap: "0",
    metadata: {
      category: "Science",
      chainId,
      createdAt: CREATED_AT.toISOString(),
      description: "A seeded route-layer market.",
      metadataCreatedAt: "2026-07-14T10:00:00.000Z",
      metadataHash: METADATA_HASH,
      outcomeNo: "No",
      outcomeYes: "Yes",
      question: "Will the seeded measurement exceed 42?",
      resolutionCriteria:
        "Resolve YES if the published measurement exceeds 42.",
      resolutionSources: ["https://example.com/measurement"],
      resolutionUrl: "https://example.com/measurement",
      updatedAt: CREATED_AT.toISOString(),
    },
    metadataHash: METADATA_HASH,
    noShares: "44444444444444444444444",
    openingProbabilityWad: "555000000000000000",
    receiptCount: "12345678901234567890",
    resolutionTime: RESOLUTION_TIME.toISOString(),
    status: "bootstrap",
    totalEscrowed: "66666666666666666666666",
    updatedAt: CREATED_AT.toISOString(),
    yesShares: "55555555555555555555555",
  };
}

/**
 * Shared shape of the three terminal-state fixtures: the primary market's
 * serialization with the older timestamps and per-market status overrides.
 */
function expectedTerminalMarket(
  marketId: bigint,
  status: "cancelled" | "resolved",
  index: number,
) {
  return {
    ...expectedMarket(),
    createdAt: TERMINAL_CREATED_AT.toISOString(),
    createdBlockTimestamp: TERMINAL_CREATED_AT.toISOString(),
    createdLogIndex: index,
    createdTransactionHash: `0x${"66".repeat(31)}0${index}`,
    marketId: marketId.toString(),
    status,
    updatedAt: TERMINAL_CREATED_AT.toISOString(),
  };
}

function expectedPostgrad() {
  return {
    adapterAddress: POSTGRAD_ADAPTER,
    completeSetCount: (2_500n * 10n ** 18n).toString(),
    finalizedAt: GRADUATED_AT.toISOString(),
    marketAddress: POSTGRAD_MARKET,
    refundTotal: (100n * 10n ** 18n).toString(),
    retainedCostTotal: (2_400n * 10n ** 18n).toString(),
    transactionHash: GRADUATION_TRANSACTION_HASH,
  };
}

function expectedDrawMarket() {
  return {
    ...expectedTerminalMarket(DRAW_MARKET_ID, "cancelled", 0),
    postgrad: expectedPostgrad(),
    resolution: {
      kind: "cancelled",
      postgradMarket: POSTGRAD_MARKET,
      resolvedAt: SETTLED_AT.toISOString(),
      transactionHash: SETTLEMENT_TRANSACTION_HASH,
    },
  };
}

function expectedResolvedMarket() {
  return {
    ...expectedTerminalMarket(RESOLVED_MARKET_ID, "resolved", 1),
    postgrad: expectedPostgrad(),
    resolution: {
      kind: "resolved",
      postgradMarket: POSTGRAD_MARKET,
      resolvedAt: SETTLED_AT.toISOString(),
      transactionHash: SETTLEMENT_TRANSACTION_HASH,
      winningSide: "yes",
    },
  };
}

describe("market routes", () => {
  it("lists the seeded market through the chainId filter with exact serialization", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets?chainId=${chainId}`),
    );

    expect(response.status).toBe(200);
    // Newest first: the primary market, then the three older terminal
    // fixtures in insertion order. The postgrad venue block only appears on
    // detail reads, so the list rows carry the event-sourced postgrad data.
    expect(await response.json()).toEqual([
      expectedMarket(),
      expectedDrawMarket(),
      expectedResolvedMarket(),
      expectedTerminalMarket(PREGRAD_CANCELLED_MARKET_ID, "cancelled", 2),
    ]);
  });

  it("keeps the postgrad payload on a draw-cancelled market detail read", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets/${chainId}/${DRAW_MARKET_ID}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedDrawMarket());
  });

  it("serializes the winning side on a resolved market detail read", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets/${chainId}/${RESOLVED_MARKET_ID}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedResolvedMarket());
  });

  it("returns no postgrad payload for a pregrad admin-cancelled market", async () => {
    const response = await app.handle(
      new Request(
        `http://localhost/markets/${chainId}/${PREGRAD_CANCELLED_MARKET_ID}`,
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe("cancelled");
    expect(body.postgrad).toBeUndefined();
    expect(body.resolution).toBeUndefined();
  });

  it("returns the seeded market detail", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets/${chainId}/${MARKET_ID}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedMarket());
  });

  it("returns 404 for an unknown market id", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets/${chainId}/999999`),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Market not found");
  });

  it("returns 400 for an invalid since query parameter", async () => {
    const response = await app.handle(
      new Request("http://localhost/markets?since=not-a-timestamp"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid since timestamp");
  });
});
