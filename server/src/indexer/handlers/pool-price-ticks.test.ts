import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { count } from "drizzle-orm";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";
import {
  buildPoolPriceTickRecord,
  persistPoolPriceTickRecord,
  type PoolPriceTickLog,
} from "src/indexer/handlers/pool-price-ticks";

const CHAIN_ID = 5042002;
const POOL_ID = `0x${"AB".repeat(32)}` as `0x${string}`;
const TX_HASH = `0x${"cc".repeat(32)}`;
const BLOCK_TIMESTAMP = new Date("2026-07-17T00:00:00Z");

describe("buildPoolPriceTickRecord", () => {
  it("maps a tick observation log and lowercases the poolId", () => {
    const record = buildPoolPriceTickRecord(
      buildInput({ poolId: POOL_ID, tick: -1573 }),
    );

    expect(record).toEqual({
      blockNumber: 321n,
      blockTimestamp: BLOCK_TIMESTAMP,
      chainId: CHAIN_ID,
      contractId: 9,
      logIndex: 7,
      poolId: POOL_ID.toLowerCase(),
      tick: -1573,
      transactionHash: TX_HASH,
    });
  });

  it("keeps a zero tick", () => {
    const record = buildPoolPriceTickRecord(
      buildInput({ poolId: POOL_ID, tick: 0 }),
    );

    expect(record.tick).toBe(0);
  });

  it.each([
    ["poolId", { tick: 42 }],
    ["tick", { poolId: POOL_ID }],
  ])("throws when the log is missing %s", (name, args) => {
    expect(() => buildPoolPriceTickRecord(buildInput(args))).toThrow(
      `Pool price tick log is missing ${name}.`,
    );
  });

  it("throws when the log is missing blockNumber", () => {
    const input = buildInput({ poolId: POOL_ID, tick: 42 });
    input.log.blockNumber = null;

    expect(() => buildPoolPriceTickRecord(input)).toThrow(
      "Pool price tick log is missing blockNumber.",
    );
  });
});

describe("persistPoolPriceTickRecord against real SQL (PGlite)", () => {
  let dbc: typeof productionDb;
  let teardownDb: () => Promise<void>;

  beforeAll(async () => {
    ({ dbc, teardown: teardownDb } = await createPgliteDb());

    await dbc.insert(schema.contracts).values({
      address: "0x00000000000000000000000000000000000000cc",
      chainId: CHAIN_ID,
      name: "BoundedPredictionHook",
    });
  });

  afterAll(async () => {
    await teardownDb();
  });

  async function tickCount() {
    const [row] = await dbc
      .select({ value: count() })
      .from(schema.poolPriceTicks);
    return row.value;
  }

  it("persists the tick row", async () => {
    await persistPoolPriceTickRecord(tickRecord(), dbc);

    expect(await tickCount()).toBe(1);
  });

  it("dedups a replay via the real unique index", async () => {
    await persistPoolPriceTickRecord(tickRecord(), dbc);

    expect(await tickCount()).toBe(1);
  });

  it("stores a second observation in the same tx under a new log index", async () => {
    await persistPoolPriceTickRecord(tickRecord({ logIndex: 8 }), dbc);

    expect(await tickCount()).toBe(2);
  });

  function tickRecord(
    overrides: Partial<typeof schema.poolPriceTicks.$inferInsert> = {},
  ) {
    return {
      ...buildPoolPriceTickRecord(buildInput({ poolId: POOL_ID, tick: -1573 })),
      contractId: 1,
      ...overrides,
    };
  }
});

function buildInput(args: Record<string, unknown>) {
  return {
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId: 9,
    log: {
      args,
      blockNumber: 321n,
      logIndex: 7,
      transactionHash: TX_HASH,
    } as unknown as PoolPriceTickLog,
  };
}
