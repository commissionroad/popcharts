import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

const MARKET_ID = 91n;
const OWNER = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const OUTCOME_TOKEN = "0x00000000000000000000000000000000000000cc";
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000dd";
const POOL_ID = `0x${"44".repeat(32)}`;
const METADATA_HASH = `0x${"55".repeat(32)}`;
const BALANCE = 123_456_789_000_000_000_000n;
const SEEDED_AT = new Date("2026-07-14T12:00:00.000Z");

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
    createdAt: SEEDED_AT,
    description: "Portfolio route seed data.",
    metadataCreatedAt: "2026-07-14T10:00:00.000Z",
    metadataHash: METADATA_HASH,
    question: "Will the portfolio seed resolve YES?",
    resolutionCriteria: "Resolve from the published result.",
    updatedAt: SEEDED_AT,
  });
  await dbc.insert(schema.markets).values({
    chainId,
    collateral: COLLATERAL,
    contractId: contract.id,
    createdAt: SEEDED_AT,
    createdBlockNumber: 100n,
    createdBlockTimestamp: SEEDED_AT,
    createdLogIndex: 0,
    createdTransactionHash: `0x${"66".repeat(32)}`,
    creator: OWNER,
    graduationThreshold: 1_000_000n,
    graduationTime: new Date("2026-08-01T00:00:00.000Z"),
    liquidityParameter: 1_000_000_000n,
    marketId: MARKET_ID,
    metadataHash: METADATA_HASH,
    openingProbabilityWad: 500_000_000_000_000_000n,
    resolutionTime: new Date("2026-09-01T00:00:00.000Z"),
    status: "graduated",
    updatedAt: SEEDED_AT,
  });
  await dbc.insert(schema.venuePools).values({
    chainId,
    createdAt: SEEDED_AT,
    marketId: MARKET_ID,
    outcomeIsCurrency0: true,
    outcomeToken: OUTCOME_TOKEN,
    poolId: POOL_ID,
    postgradMarket: POSTGRAD_MARKET,
    side: "yes",
  });
  await dbc.insert(schema.outcomeTokenBalances).values({
    balance: BALANCE,
    chainId,
    createdAt: SEEDED_AT,
    marketId: MARKET_ID,
    outcomeToken: OUTCOME_TOKEN,
    owner: OWNER,
    side: "yes",
    updatedAt: SEEDED_AT,
    updatedBlockNumber: 101n,
  });

  ({ app } = await import("src/api"));
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

describe("portfolio route", () => {
  it("returns seeded positions without chain-derived prices when the RPC is unreachable", async () => {
    const response = await app.handle(
      new Request(`http://localhost/portfolio/${chainId}?owner=${OWNER}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chainId,
      openOrders: [],
      owner: OWNER,
      positions: [
        {
          committedInOrders: "0",
          heldBalance: BALANCE.toString(),
          marketId: MARKET_ID.toString(),
          marketQuestion: "Will the portfolio seed resolve YES?",
          outcomeToken: OUTCOME_TOKEN,
          ownedTotal: BALANCE.toString(),
          poolId: POOL_ID,
          side: "yes",
        },
      ],
      receipts: [],
      summary: {
        claimableReceiptCount: 0,
        lockedCollateral: "0",
        openOrderCount: 0,
        openReceiptCount: 0,
        positionCount: 1,
        totalPositionValueWad: "0",
      },
    });
  });
});
