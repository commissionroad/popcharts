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

  it("applies no balance deltas when the event insert dedups a replay", async () => {
    const { balanceUpserts, dbc } = fakeTransferDb({ insertedRows: [] });

    await persistOutcomeTokenTransferRecord(record(), dbc);

    expect(balanceUpserts()).toHaveLength(0);
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
 * what the event insert returns (empty means the dedup conflict fired), and
 * balance upserts are captured for assertions.
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
  };
}
