import { describe, expect, it } from "bun:test";

import { schema } from "src/db/client";
import {
  buildOutcomeTokenTransferRecord,
  persistOutcomeTokenTransferRecord,
  type OutcomeTokenTransferLog,
  type OutcomeTokenTransferRecord,
} from "src/indexer/handlers/outcome-token-transfers";

const CHAIN_ID = 5042002;
const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN = "0xAAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const ALICE = "0xB0b0000000000000000000000000000000000001";
const BOB = "0xC0C0000000000000000000000000000000000002";

describe("buildOutcomeTokenTransferRecord", () => {
  it("maps a transfer log and lowercases every address", () => {
    const record = buildOutcomeTokenTransferRecord(
      buildInput({ from: ALICE, to: BOB, value: 25n }),
    );

    expect(record).toEqual({
      blockNumber: 321n,
      blockTimestamp: BLOCK_TIMESTAMP,
      chainId: CHAIN_ID,
      contractId: 9,
      fromAddress: ALICE.toLowerCase(),
      logIndex: 7,
      marketId: 42n,
      outcomeToken: TOKEN.toLowerCase(),
      side: "yes",
      toAddress: BOB.toLowerCase(),
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      value: 25n,
    });
  });

  it.each([
    ["from", { to: BOB, value: 1n }],
    ["to", { from: ALICE, value: 1n }],
    ["value", { from: ALICE, to: BOB }],
  ])("throws when the log is missing %s", (name, args) => {
    expect(() => buildOutcomeTokenTransferRecord(buildInput(args))).toThrow(
      `Outcome token transfer log is missing ${name}.`,
    );
  });

  it("throws when the log is missing blockNumber", () => {
    const input = buildInput({ from: ALICE, to: BOB, value: 1n });
    input.log.blockNumber = null;

    expect(() => buildOutcomeTokenTransferRecord(input)).toThrow(
      "Outcome token transfer log is missing blockNumber.",
    );
  });
});

describe("persistOutcomeTokenTransferRecord", () => {
  it("debits the sender and credits the recipient for a wallet-to-wallet transfer", async () => {
    const { balanceUpserts, dbc } = fakeTransferDb({
      insertedRows: [{ id: 1 }],
    });

    await persistOutcomeTokenTransferRecord(record(), dbc);

    const upserts = balanceUpserts();
    expect(upserts).toHaveLength(2);
    expect(upserts[0]!.values).toMatchObject({
      balance: -25n,
      chainId: CHAIN_ID,
      marketId: 42n,
      outcomeToken: TOKEN.toLowerCase(),
      owner: ALICE.toLowerCase(),
      side: "yes",
      updatedBlockNumber: 321n,
    });
    expect(upserts[1]!.values).toMatchObject({
      balance: 25n,
      owner: BOB.toLowerCase(),
    });
  });

  it("skips the zero-address leg on a mint", async () => {
    const { balanceUpserts, dbc } = fakeTransferDb({
      insertedRows: [{ id: 1 }],
    });

    await persistOutcomeTokenTransferRecord(record({ fromAddress: ZERO }), dbc);

    const upserts = balanceUpserts();
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.values).toMatchObject({
      balance: 25n,
      owner: BOB.toLowerCase(),
    });
  });

  it("skips the zero-address leg on a burn", async () => {
    const { balanceUpserts, dbc } = fakeTransferDb({
      insertedRows: [{ id: 1 }],
    });

    await persistOutcomeTokenTransferRecord(record({ toAddress: ZERO }), dbc);

    const upserts = balanceUpserts();
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.values).toMatchObject({
      balance: -25n,
      owner: ALICE.toLowerCase(),
    });
  });

  it("applies no balance deltas and no live signals when the event insert dedups a replay", async () => {
    const { balanceUpserts, dbc, liveChanges } = fakeTransferDb({
      insertedRows: [],
    });

    await persistOutcomeTokenTransferRecord(record(), dbc);

    expect(balanceUpserts()).toHaveLength(0);
    expect(liveChanges()).toHaveLength(0);
  });

  it("signals both holders' portfolios on a wallet-to-wallet transfer", async () => {
    const { dbc, liveChanges } = fakeTransferDb({ insertedRows: [{ id: 3 }] });

    await persistOutcomeTokenTransferRecord(record(), dbc);

    expect(liveChanges()).toHaveLength(2);
    expect(liveChanges()[0]).toMatchObject({
      sourceTable: "outcome_token_transfer_events",
      op: "insert",
      chainId: CHAIN_ID,
      marketId: "42",
      owner: ALICE.toLowerCase(),
      rowId: "3",
      blockNumber: 321n,
      logIndex: 7,
    });
    expect(liveChanges()[1]).toMatchObject({ owner: BOB.toLowerCase() });
  });

  it("signals only the real holder on a mint", async () => {
    const { dbc, liveChanges } = fakeTransferDb({ insertedRows: [{ id: 3 }] });

    await persistOutcomeTokenTransferRecord(record({ fromAddress: ZERO }), dbc);

    expect(liveChanges()).toHaveLength(1);
    expect(liveChanges()[0]).toMatchObject({ owner: BOB.toLowerCase() });
  });

  it("signals a self-transfer's holder once", async () => {
    const { dbc, liveChanges } = fakeTransferDb({ insertedRows: [{ id: 3 }] });

    await persistOutcomeTokenTransferRecord(
      record({ toAddress: ALICE.toLowerCase() }),
      dbc,
    );

    expect(liveChanges()).toHaveLength(1);
    expect(liveChanges()[0]).toMatchObject({ owner: ALICE.toLowerCase() });
  });
});

const BLOCK_TIMESTAMP = new Date("2026-07-08T00:00:00Z");

function buildInput(args: Record<string, unknown>) {
  return {
    blockTimestamp: BLOCK_TIMESTAMP,
    config: { chainId: CHAIN_ID },
    contractId: 9,
    log: {
      address: TOKEN,
      args,
      blockNumber: 321n,
      logIndex: 7,
      transactionHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    } as unknown as OutcomeTokenTransferLog,
    marketId: 42n,
    side: "yes" as const,
  };
}

function record(
  overrides: Partial<OutcomeTokenTransferRecord> = {},
): OutcomeTokenTransferRecord {
  return {
    ...buildOutcomeTokenTransferRecord(
      buildInput({ from: ALICE, to: BOB, value: 25n }),
    ),
    ...overrides,
  };
}

/**
 * Minimal stand-in for the transactional drizzle handle: `insertedRows` is
 * what the event insert returns (empty means the dedup conflict fired);
 * balance upserts and change_feed live-signal rows are captured for
 * assertions.
 */
function fakeTransferDb({
  insertedRows,
}: {
  insertedRows: Array<{ id: number }>;
}) {
  const balanceUpserts: Array<{
    set: Record<string, unknown>;
    values: Record<string, unknown>;
  }> = [];
  const liveChanges: Array<Record<string, unknown>> = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === schema.outcomeTokenTransferEvents) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => insertedRows,
            }),
          };
        }

        if (table === schema.changeFeed) {
          liveChanges.push(values);
          return Promise.resolve();
        }

        return {
          onConflictDoUpdate: async (options: {
            set: Record<string, unknown>;
          }) => {
            balanceUpserts.push({ set: options.set, values });
          },
        };
      },
    }),
  };
  const dbc = {
    transaction: (callback: (handle: typeof tx) => Promise<void>) =>
      callback(tx),
  } as unknown as Parameters<typeof persistOutcomeTokenTransferRecord>[1];

  return {
    balanceUpserts: () => balanceUpserts,
    dbc,
    liveChanges: () => liveChanges,
  };
}
