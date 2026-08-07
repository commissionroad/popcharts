// Real-SQL tier for the dispute-window status projection: the guards are
// WHERE clauses, so only real SQL can show that a replayed or out-of-order log
// leaves markets.status alone. Covers the widened terminal guard too — a
// market that went through a proposal must still project resolved/cancelled.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";

import { count, eq } from "drizzle-orm";

import * as schema from "src/db/schema";
import type { db as productionDb } from "src/db/client";
import { createPgliteDb } from "src/test-support/pglite-db";
import {
  persistPostgradDisputeRecord,
  type PostgradDisputeRecord,
} from "src/indexer/handlers/postgrad-dispute";
import {
  persistPostgradDisputeBondRecord,
  type PostgradDisputeBondRecord,
} from "src/indexer/handlers/postgrad-dispute-bond";
import { MarketStatusOutOfOrderError } from "src/indexer/handlers/market-projection";
import {
  persistPostgradResolutionRecord,
  type PostgradResolutionRecord,
} from "src/indexer/handlers/postgrad-resolution";
import type { MarketStatus } from "src/db/schema/markets";
import {
  formatOperatorAlert,
  OPERATOR_ALERT_EVENTS,
} from "src/shared/operator-alert-log";

const CHAIN_ID = 31337;
const MARKET_ID = 7n;
const POSTGRAD_MARKET = "0x00000000000000000000000000000000000000ee";
const DISPUTER = "0x00000000000000000000000000000000000000ab";

let dbc: typeof productionDb;
let resetDb: () => Promise<void>;
let teardownDb: () => Promise<void>;

function disputeRecord(
  overrides: Partial<PostgradDisputeRecord["event"]> = {},
): PostgradDisputeRecord {
  return {
    event: {
      blockNumber: 100n,
      blockTimestamp: new Date("2026-07-14T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      disputeDeadline: new Date("2026-07-15T00:00:00Z"),
      disputer: null,
      kind: "proposed",
      logIndex: 3,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      proposedSide: "yes",
      transactionHash: `0x${"11".repeat(32)}`,
      ...overrides,
    },
  };
}

const OPERATOR_ALERT = "POPCHARTS_OPERATOR_ALERT resolution_disputed {}";

function disputedRecord(): PostgradDisputeRecord {
  return {
    ...disputeRecord({
      disputeDeadline: null,
      disputer: DISPUTER,
      kind: "disputed",
      logIndex: 4,
      proposedSide: null,
      transactionHash: `0x${"22".repeat(32)}`,
    }),
    operatorAlert: OPERATOR_ALERT,
  };
}

function resolutionRecord(): PostgradResolutionRecord {
  return {
    event: {
      blockNumber: 102n,
      blockTimestamp: new Date("2026-07-16T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      kind: "resolved",
      logIndex: 5,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      transactionHash: `0x${"33".repeat(32)}`,
      winningSide: "yes",
    },
  };
}

async function marketStatus(): Promise<MarketStatus> {
  const [row] = await dbc
    .select({ status: schema.markets.status })
    .from(schema.markets)
    .where(eq(schema.markets.marketId, MARKET_ID));
  return row!.status;
}

async function setMarketStatus(status: MarketStatus) {
  await dbc
    .update(schema.markets)
    .set({ status })
    .where(eq(schema.markets.marketId, MARKET_ID));
}

beforeAll(async () => {
  ({ dbc, reset: resetDb, teardown: teardownDb } = await createPgliteDb());
});

afterAll(async () => {
  await teardownDb();
});

// One instance per file, emptied between tests: a PGlite costs ~1.2-2GB
// resident that close() does not hand back, so booting one per test runs the
// allocator out of room. reset() also beats a hand-listed set of deletes,
// which silently stops covering a table the moment one is added. It truncates
// the fixture rows too, so they are seeded here rather than once in beforeAll.
beforeEach(async () => {
  await resetDb();

  await dbc.insert(schema.contracts).values({
    address: "0x00000000000000000000000000000000000000cc",
    chainId: CHAIN_ID,
    name: "PregradManager",
  });
  await dbc.insert(schema.markets).values({
    chainId: CHAIN_ID,
    contractId: 1,
    marketId: MARKET_ID,
    creator: "0x00000000000000000000000000000000000000aa",
    metadataHash: `0x${"22".repeat(32)}`,
    collateral: "0x00000000000000000000000000000000000000dd",
    openingProbabilityWad: 500000000000000000n,
    liquidityParameter: 1000000000n,
    graduationThreshold: 1000000n,
    graduationTime: new Date("2026-08-01T00:00:00Z"),
    resolutionTime: new Date("2026-09-01T00:00:00Z"),
    createdBlockNumber: 99n,
    createdBlockTimestamp: new Date("2026-07-13T00:00:00Z"),
    createdTransactionHash: `0x${"33".repeat(32)}`,
    createdLogIndex: 0,
    status: "graduated",
  });
});

function bondRecord(): PostgradDisputeBondRecord {
  return {
    event: {
      amount: 100_000_000n,
      blockNumber: 101n,
      blockTimestamp: new Date("2026-07-15T00:00:00Z"),
      chainId: CHAIN_ID,
      contractId: 1,
      disputer: DISPUTER,
      kind: "posted",
      logIndex: 6,
      marketId: MARKET_ID,
      postgradMarket: POSTGRAD_MARKET,
      transactionHash: `0x${"44".repeat(32)}`,
    },
  };
}

describe("persistPostgradDisputeRecord against real SQL (PGlite)", () => {
  it("moves a graduated market into resolution_pending and signals the feed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await marketStatus()).toBe("resolution_pending");
    const [signal] = await dbc
      .select({ sourceTable: schema.changeFeed.sourceTable })
      .from(schema.changeFeed);
    expect(signal?.sourceTable).toBe("postgrad_dispute_events");
  });

  it("moves a pending market into disputed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);

    expect(await marketStatus()).toBe("disputed");
  });

  it("dedups a replayed log and leaves the status where it is", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await marketStatus()).toBe("disputed");
    const [events] = await dbc
      .select({ value: count() })
      .from(schema.postgradDisputeEvents);
    expect(events!.value).toBe(2);
    // The replay must not signal again either, or the UI refetches for nothing.
    const [signals] = await dbc
      .select({ value: count() })
      .from(schema.changeFeed);
    expect(signals!.value).toBe(2);
  });

  it("projects a dispute that arrives before its own proposal", async () => {
    // A recovery sweep racing the live subscription can deliver these two out
    // of order. `disputed` accepts `graduated` because the dispute log implies
    // the proposal, so the market must not sit on a countdown that will never
    // finalize. Do not tidy the guard back to a single predecessor status.
    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    expect(await marketStatus()).toBe("disputed");

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    // The late proposal finds the market already past its target and no-ops.
    expect(await marketStatus()).toBe("disputed");
  });

  it("pages once per dispute and never on a replay", async () => {
    const alerts = spyOn(console, "error").mockImplementation(() => {});
    try {
      await persistPostgradDisputeRecord(disputeRecord(), dbc);
      await persistPostgradDisputeRecord(disputedRecord(), dbc);
      await persistPostgradDisputeRecord(disputedRecord(), dbc);

      // The proposal must not page — only the dispute freezes the market.
      expect(alerts.mock.calls).toEqual([[OPERATOR_ALERT]]);
    } finally {
      alerts.mockRestore();
    }
  });

  it("pages the halt, not the dispute, when a dispute rolls back as out of order", async () => {
    await setMarketStatus("bootstrap");
    const alerts = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        persistPostgradDisputeRecord(disputedRecord(), dbc),
      ).rejects.toThrow(MarketStatusOutOfOrderError);

      // Two pages with opposite commit rules meet here. The dispute page must
      // not fire: its row rolled back, so it would send an operator to a market
      // that never entered the window, and the retry pages when it lands. The
      // guard's own page must fire: the throw abandons the sweep that hit it,
      // wedging a whole cursor group, not one event waiting its turn.
      //
      // Pinned whole. Everything in the record rolled back with the row, so
      // this is the only surviving statement of which market to unwedge and
      // which log to replay.
      expect(alerts.mock.calls).toEqual([
        [
          formatOperatorAlert(OPERATOR_ALERT_EVENTS.marketStatusOutOfOrder, {
            allowedFrom: "resolution_pending,graduated",
            blockNumber: "100",
            chainId: CHAIN_ID,
            currentStatus: "bootstrap",
            logIndex: 4,
            marketId: MARKET_ID.toString(),
            targetStatus: "disputed",
            transactionHash: `0x${"22".repeat(32)}`,
          }),
        ],
      ]);
    } finally {
      alerts.mockRestore();
    }
  });

  it("never drags a resolved market back into the dispute window", async () => {
    await setMarketStatus("resolved");

    // Neither kind may reopen a terminal market — the widened `disputed`
    // predecessor set adds `graduated`, not the terminal statuses.
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    expect(await marketStatus()).toBe("resolved");

    await persistPostgradDisputeRecord(disputedRecord(), dbc);
    expect(await marketStatus()).toBe("resolved");
  });

  it("throws and rolls the event back when the market is in no valid predecessor", async () => {
    await setMarketStatus("bootstrap");

    await expect(
      persistPostgradDisputeRecord(disputeRecord(), dbc),
    ).rejects.toThrow(MarketStatusOutOfOrderError);

    expect(await marketStatus()).toBe("bootstrap");
    // The rollback is the point: a committed event row would make every later
    // replay dedupe out before reaching the projection, losing it forever.
    const [events] = await dbc
      .select({ value: count() })
      .from(schema.postgradDisputeEvents);
    expect(events!.value).toBe(0);
  });
});

describe("persistPostgradDisputeBondRecord against real SQL (PGlite)", () => {
  it("signals the market once per bond movement and never touches the status", async () => {
    await persistPostgradDisputeBondRecord(bondRecord(), dbc);
    await persistPostgradDisputeBondRecord(bondRecord(), dbc);

    const [rows] = await dbc
      .select({ value: count() })
      .from(schema.postgradDisputeBondEvents);
    expect(rows!.value).toBe(1);
    const signals = await dbc
      .select({ sourceTable: schema.changeFeed.sourceTable })
      .from(schema.changeFeed);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.sourceTable).toBe("postgrad_dispute_bond_events");
    // Money rows are a paper trail, not a lifecycle signal.
    expect(await marketStatus()).toBe("graduated");
  });
});

describe("persistPostgradResolutionRecord terminal guard (PGlite)", () => {
  it("resolves a market that is sitting in resolution_pending", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("resolves a market an operator settled out of disputed", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputedRecord(), dbc);

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("still resolves the legacy direct path from graduated", async () => {
    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    expect(await marketStatus()).toBe("resolved");
  });

  it("throws and rolls back rather than losing a terminal status forever", async () => {
    // The bug this guards: the raw event row used to commit while the guarded
    // UPDATE matched nothing, and the next replay deduped out before it could
    // retry — leaving a market that reads graduated while the chain says
    // Resolved, permanently and silently.
    await setMarketStatus("graduating");

    await expect(
      persistPostgradResolutionRecord(resolutionRecord(), dbc),
    ).rejects.toThrow(MarketStatusOutOfOrderError);

    expect(await marketStatus()).toBe("graduating");
    const [events] = await dbc
      .select({ value: count() })
      .from(schema.postgradResolutionEvents);
    expect(events!.value).toBe(0);
  });

  it("no-ops when the market already reached a terminal status", async () => {
    await setMarketStatus("cancelled");

    await persistPostgradResolutionRecord(resolutionRecord(), dbc);

    // A contradiction the chain cannot emit; throwing here would wedge the
    // shared postgrad cursor forever, so it is treated as already settled.
    expect(await marketStatus()).toBe("cancelled");
  });
});

/**
 * Seeds the row the runner writes before proposing (ADR 0026 phase 3), so the
 * proposal event has something to confirm.
 */
async function seedPendingResolution(
  verdict: "resolve_yes" | "resolve_no" = "resolve_yes",
) {
  // The shared fixture seeds markets but not market_metadata, which the
  // resolutions FK requires; only this describe block needs it.
  await dbc.insert(schema.marketMetadata).values({
    category: "Testing",
    chainId: CHAIN_ID,
    description: "A graduated market whose proposal is in flight.",
    metadataCreatedAt: "2026-07-13T00:00:00.000Z",
    metadataHash: `0x${"22".repeat(32)}`,
    question: "Does the proposal event confirm the pending row?",
    resolutionCriteria: "Resolves YES when it does.",
  });
  const [row] = await dbc
    .insert(schema.marketResolutions)
    .values({
      chainId: CHAIN_ID,
      commitState: "pending",
      evidence: [],
      hardFlags: [],
      marketId: MARKET_ID,
      metadataHash: `0x${"22".repeat(32)}`,
      outcome: verdict === "resolve_yes" ? "yes" : "no",
      promptVersion: "v1",
      provider: "anthropic",
      reasons: ["The event concluded."],
      sourceChecks: [],
      verdict,
    })
    .returning();
  return row!;
}

async function resolutionRows() {
  return await dbc.select().from(schema.marketResolutions);
}

describe("proposal events confirm the runner's pending row (ADR 0026)", () => {
  it("confirms the pending row and stamps resolved_at from the block", async () => {
    await seedPendingResolution("resolve_yes");

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    const [row] = await resolutionRows();
    expect(row).toMatchObject({
      commitState: "confirmed",
      resolvedAt: new Date("2026-07-14T00:00:00Z"),
    });
  });

  it("signals the market page for the confirmation, atomic with it", async () => {
    await seedPendingResolution("resolve_yes");

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    const signals = await dbc
      .select({
        op: schema.changeFeed.op,
        table: schema.changeFeed.sourceTable,
      })
      .from(schema.changeFeed);
    expect(signals).toContainEqual({
      op: "update",
      table: "market_resolutions",
    });
  });

  // Operator and creator self-resolve proposals never had a pending row.
  it("no-ops without error when no pending row exists", async () => {
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    expect(await resolutionRows()).toHaveLength(0);
    expect(await marketStatus()).toBe("resolution_pending");
  });

  it("does not re-confirm or re-signal on a replayed log", async () => {
    await seedPendingResolution("resolve_yes");
    await persistPostgradDisputeRecord(disputeRecord(), dbc);
    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    const signals = await dbc
      .select({ table: schema.changeFeed.sourceTable })
      .from(schema.changeFeed);
    expect(
      signals.filter(({ table }) => table === "market_resolutions"),
    ).toHaveLength(1);
  });

  it("never rewrites a row another path already settled", async () => {
    const settledAt = new Date("2026-07-10T00:00:00Z");
    await seedPendingResolution("resolve_yes");
    await dbc
      .update(schema.marketResolutions)
      .set({ commitState: "confirmed", resolvedAt: settledAt });

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    const [row] = await resolutionRows();
    // The CAS on `pending` means the earlier settlement's timestamp survives.
    expect(row?.resolvedAt).toEqual(settledAt);
  });

  // An opposite-side proposal is authoritative evidence the AI's judgment lost
  // the race: the event that could have confirmed it has now been consumed, so
  // leaving the row pending would be an eternal lie in the operator lens — and
  // (ADR 0026 review) the market is resolving AGAINST the recorded judgment,
  // which is exactly when a human should look.
  it("supersedes a pending row whose verdict lost to the other side, and pages", async () => {
    const alerts = spyOn(console, "error").mockImplementation(() => {});
    try {
      await seedPendingResolution("resolve_no");

      await persistPostgradDisputeRecord(disputeRecord(), dbc);

      const [row] = await resolutionRows();
      expect(row).toMatchObject({
        commitState: "superseded",
        resolvedAt: new Date("2026-07-14T00:00:00Z"),
        // The judgment columns are untouched: superseded preserves what the
        // AI concluded, truthfully never acted on.
        verdict: "resolve_no",
      });
      expect(
        alerts.mock.calls.some(([line]) =>
          String(line).includes("resolution_superseded"),
        ),
      ).toBe(true);
    } finally {
      alerts.mockRestore();
    }
  });

  it("signals the feed for a superseded settlement too", async () => {
    const alerts = spyOn(console, "error").mockImplementation(() => {});
    try {
      await seedPendingResolution("resolve_no");

      await persistPostgradDisputeRecord(disputeRecord(), dbc);

      const signals = await dbc
        .select({
          op: schema.changeFeed.op,
          table: schema.changeFeed.sourceTable,
        })
        .from(schema.changeFeed);
      expect(signals).toContainEqual({
        op: "update",
        table: "market_resolutions",
      });
    } finally {
      alerts.mockRestore();
    }
  });

  it("does not page a supersede on a replayed log", async () => {
    const alerts = spyOn(console, "error").mockImplementation(() => {});
    try {
      await seedPendingResolution("resolve_no");
      await persistPostgradDisputeRecord(disputeRecord(), dbc);
      await persistPostgradDisputeRecord(disputeRecord(), dbc);

      const supersededPages = alerts.mock.calls.filter(([line]) =>
        String(line).includes("resolution_superseded"),
      );
      expect(supersededPages).toHaveLength(1);
    } finally {
      alerts.mockRestore();
    }
  });

  // The settlement is scoped to the market's CURRENT metadata version through
  // the markets row, mirroring every other resolution query — a leftover
  // pending row from a stale metadata version must not be settled by the
  // current version's event.
  it("leaves a pending row from a different metadata version alone", async () => {
    const staleHash = `0x${"77".repeat(32)}`;
    await dbc.insert(schema.marketMetadata).values({
      category: "Testing",
      chainId: CHAIN_ID,
      description: "A stale metadata version.",
      metadataCreatedAt: "2026-07-12T00:00:00.000Z",
      metadataHash: staleHash,
      question: "The stale version of the question?",
      resolutionCriteria: "Resolves YES under the old criteria.",
    });
    await dbc.insert(schema.markets).values({
      chainId: CHAIN_ID,
      collateral: "0x00000000000000000000000000000000000000dd",
      contractId: 1,
      createdBlockNumber: 98n,
      createdBlockTimestamp: new Date("2026-07-12T00:00:00Z"),
      createdLogIndex: 1,
      createdTransactionHash: `0x${"88".repeat(32)}`,
      creator: "0x00000000000000000000000000000000000000aa",
      graduationThreshold: 1_000_000n,
      graduationTime: new Date("2026-08-01T00:00:00Z"),
      liquidityParameter: 1_000_000_000n,
      marketId: 8n,
      metadataHash: staleHash,
      openingProbabilityWad: 500_000_000_000_000_000n,
      resolutionTime: new Date("2026-09-01T00:00:00Z"),
      status: "graduated",
    });
    const [staleRow] = await dbc
      .insert(schema.marketResolutions)
      .values({
        chainId: CHAIN_ID,
        commitState: "pending",
        evidence: [],
        hardFlags: [],
        marketId: 8n,
        metadataHash: staleHash,
        outcome: "yes",
        promptVersion: "v1",
        provider: "anthropic",
        reasons: ["A different market's judgment."],
        sourceChecks: [],
        verdict: "resolve_yes",
      })
      .returning();

    await persistPostgradDisputeRecord(disputeRecord(), dbc);

    const [after] = await dbc
      .select()
      .from(schema.marketResolutions)
      .where(eq(schema.marketResolutions.id, staleRow!.id));
    // Market 7's event settles nothing on market 8.
    expect(after?.commitState).toBe("pending");
  });
});
