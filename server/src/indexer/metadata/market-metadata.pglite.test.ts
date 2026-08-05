// Real-SQL tier for the event-payload metadata store — the only metadata
// writer once ADR 0022 P6 drops the off-chain POST. What only real SQL can
// show: the upsert converges on (chain_id, metadata_hash) instead of
// duplicating, a divergent pre-existing row is healed to the event's payload,
// and a database-level failure surfaces as the parkable
// MarketMetadataWriteError instead of being swallowed or abandoning the sweep.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { keccak256, stringToBytes } from "viem";

import type { db as productionDb } from "src/db/client";
import * as schema from "src/db/schema";
import {
  MarketMetadataWriteError,
  type MarketMetadataPayload,
  persistMarketMetadataFromEventPayload,
  serializeMarketMetadata,
} from "src/indexer/metadata/market-metadata";
import { createPgliteDb } from "src/test-support/pglite-db";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;

const payload: MarketMetadataPayload = {
  category: "Crypto",
  createdAt: "2026-08-05T12:00:00.000Z",
  description: "Resolve from the creation event payload.",
  question: "Will the event payload persist?",
  resolutionCriteria: "YES if the indexer writes this row.",
  resolutionSources: ["https://www.example.com/source"],
  version: 1,
};

// The canonical bytes and their hash come from the module under test on
// purpose: this tier asserts SQL behavior for a payload that resolves, and
// the unit tests in market-metadata.test.ts already pin the byte layout
// against an independent restatement.
const metadata = serializeMarketMetadata(payload);
const metadataHash = keccak256(stringToBytes(metadata));

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One PGlite per file, emptied between tests — see the note in
// review-bond.pglite.test.ts on why an instance per test exhausts memory.
beforeEach(async () => {
  await resetDb();
});

describe("persistMarketMetadataFromEventPayload", () => {
  it("persists the event payload keyed by chain and hash", async () => {
    await persistMarketMetadataFromEventPayload(
      { chainId: CHAIN_ID, marketId: MARKET_ID, metadata, metadataHash },
      dbc,
    );

    const rows = await dbc.select().from(schema.marketMetadata);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: payload.category,
      chainId: CHAIN_ID,
      metadataCreatedAt: payload.createdAt,
      metadataHash,
      question: payload.question,
      resolutionSources: payload.resolutionSources,
    });
  });

  it("converges a replayed delivery and heals a divergent row", async () => {
    // A row the pre-P6 POST path wrote without hash verification: same key,
    // different text. The event payload must win.
    await dbc.insert(schema.marketMetadata).values({
      category: "Stale",
      chainId: CHAIN_ID,
      description: "unverified",
      metadataCreatedAt: payload.createdAt,
      metadataHash,
      question: "A question the chain never committed to",
      resolutionCriteria: "unverified",
      resolutionSources: [],
    });

    await persistMarketMetadataFromEventPayload(
      { chainId: CHAIN_ID, marketId: MARKET_ID, metadata, metadataHash },
      dbc,
    );
    await persistMarketMetadataFromEventPayload(
      { chainId: CHAIN_ID, marketId: MARKET_ID, metadata, metadataHash },
      dbc,
    );

    const rows = await dbc.select().from(schema.marketMetadata);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.question).toBe(payload.question);
    expect(rows[0]?.category).toBe(payload.category);
  });

  it("skips an unparseable payload without writing or throwing", async () => {
    await persistMarketMetadataFromEventPayload(
      {
        chainId: CHAIN_ID,
        marketId: MARKET_ID,
        metadata: "not json at all",
        metadataHash,
      },
      dbc,
    );
    await persistMarketMetadataFromEventPayload(
      { chainId: CHAIN_ID, marketId: MARKET_ID, metadata: null, metadataHash },
      dbc,
    );

    expect(await dbc.select().from(schema.marketMetadata)).toHaveLength(0);
  });

  it("skips a payload whose bytes do not match the committed hash", async () => {
    await persistMarketMetadataFromEventPayload(
      {
        chainId: CHAIN_ID,
        marketId: MARKET_ID,
        metadata,
        metadataHash: `0x${"f".repeat(64)}`,
      },
      dbc,
    );

    expect(await dbc.select().from(schema.marketMetadata)).toHaveLength(0);
  });

  it("wraps a database failure in the parkable MarketMetadataWriteError", async () => {
    const poisoned = {
      insert() {
        throw new Error("connection reset");
      },
    } as unknown as typeof productionDb;

    let caught: unknown;

    try {
      await persistMarketMetadataFromEventPayload(
        { chainId: CHAIN_ID, marketId: MARKET_ID, metadata, metadataHash },
        poisoned,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MarketMetadataWriteError);
    expect((caught as Error).message).toContain("marketId=7");
    expect((caught as Error).message).toContain("connection reset");
  });
});
