import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

const MARKET_ID = 77n;
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
  process.env.NETWORK = "arcTestnet";
  process.env.ARC_TESTNET_RPC_HTTP_URL = "http://127.0.0.1:1";
  process.env.ARC_TESTNET_BOUNDED_HOOK_ADDRESS =
    "0x0000000000000000000000000000000000000101";
  process.env.ARC_TESTNET_ORDER_MANAGER_ADDRESS =
    "0x0000000000000000000000000000000000000102";
  process.env.ARC_TESTNET_POOL_MANAGER_ADDRESS =
    "0x0000000000000000000000000000000000000103";
  process.env.ARC_TESTNET_POOL_TICK_BOUNDS_ADDRESS =
    "0x0000000000000000000000000000000000000104";
  process.env.ARC_TESTNET_STATE_VIEW_ADDRESS =
    "0x0000000000000000000000000000000000000105";

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

describe("market routes", () => {
  it("lists the seeded market through the chainId filter with exact serialization", async () => {
    const response = await app.handle(
      new Request(`http://localhost/markets?chainId=${chainId}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expectedMarket()]);
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
