import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { db as productionDb } from "src/db/client";
import { schema, setDbForTesting } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";

const PREGRAD_MARKET_ID = 71n;
const MISSING_MARKET_ID = 72n;
const METADATA_HASH = `0x${"6a".repeat(32)}`;
const CREATOR = "0x00000000000000000000000000000000000000aa";
const COLLATERAL = "0x00000000000000000000000000000000000000bb";
const TRANSACTION_HASH = `0x${"6b".repeat(32)}`;
const AT = new Date("2026-07-01T12:00:00.000Z");

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
    description: "Settle-route market.",
    metadataCreatedAt: AT.toISOString(),
    metadataHash: METADATA_HASH,
    question: "Will the settle route map its refusals?",
    resolutionCriteria: "Resolves YES when the event is confirmed.",
    updatedAt: AT,
  });

  await dbc.insert(schema.markets).values({
    bypassAiResolution: false,
    chainId,
    collateral: COLLATERAL,
    contractId: contract.id,
    createdAt: AT,
    createdBlockNumber: 60n,
    createdBlockTimestamp: AT,
    createdLogIndex: 1,
    createdTransactionHash: TRANSACTION_HASH,
    creator: CREATOR,
    graduationThreshold: 2_500n * 10n ** 18n,
    graduationTime: AT,
    liquidityParameter: 5_000n * 10n ** 18n,
    marketId: PREGRAD_MARKET_ID,
    metadataHash: METADATA_HASH,
    noShares: 0n,
    openingProbabilityWad: 500_000_000_000_000_000n,
    receiptCount: 0n,
    resolutionTime: AT,
    status: "bootstrap",
    totalEscrowed: 0n,
    updatedAt: AT,
    yesNotBefore: null,
    yesShares: 0n,
  });

  ({ app } = await import("src/api"));
}, 15_000);

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

async function requestSettle(
  marketId: bigint | string,
  chain: number | string = chainId,
) {
  const response = await app.handle(
    new Request(
      `http://localhost/markets/${chain}/${marketId}/resolution-finalize`,
      { method: "POST" },
    ),
  );
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");

  return {
    body: isJson ? await response.json() : await response.text(),
    status: response.status,
  };
}

// Every case here refuses before any chain client is built, which is what
// makes the route testable without a chain. The settle path itself is covered
// in `src/api/services/resolution-finalize-request.pglite.test.ts`.
describe("POST /markets/:chainId/:marketId/resolution-finalize", () => {
  it("rejects an unparseable market id with 400", async () => {
    const result = await requestSettle("not-a-number");

    expect(result.status).toBe(400);
    expect(result.body).toBe("Invalid market id.");
  });

  it("rejects an unparseable chain id with 400", async () => {
    const result = await requestSettle(PREGRAD_MARKET_ID, "not-a-chain");

    expect(result.status).toBe(400);
    expect(result.body).toBe("Invalid chain id.");
  });

  it("reports an unknown market with 404", async () => {
    const result = await requestSettle(MISSING_MARKET_ID);

    expect(result.status).toBe(404);
    expect(result.body).toBe("Market not found.");
  });

  it("refuses a market with no indexed postgrad venue with 409", async () => {
    const result = await requestSettle(PREGRAD_MARKET_ID);

    expect(result.status).toBe(409);
    expect(result.body.status).toBe("not_graduated");
    expect(result.body.message).toContain("graduated markets only");
  });
});
