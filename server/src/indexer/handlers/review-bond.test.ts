import { describe, expect, it } from "bun:test";

import {
  buildReviewBondRecord,
  type ReviewBondDepositedLog,
  type ReviewBondLog,
} from "./review-bond";

const USER = "0xAAAAAAAA00000000000000000000000000000009";
const RECIPIENT = "0xBBBBBBBB00000000000000000000000000000007";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const blockTimestamp = new Date("2026-07-30T12:00:00.000Z");

function build(
  kind: Parameters<typeof buildReviewBondRecord>[0]["kind"],
  args: object,
) {
  return buildReviewBondRecord({
    blockTimestamp,
    config: { chainId: 5042002 },
    contractId: 42,
    kind,
    log: { ...BASE_LOG, args } as ReviewBondLog,
  });
}

describe("buildReviewBondRecord", () => {
  it("maps ReviewBondDeposited to a deposited row with the lowercased user and lifetime-deposit total", () => {
    const record = build("deposited", {
      amount: 5_000_000n,
      totalDeposited: 12_000_000n,
      user: USER,
    });

    expect(record.event).toEqual({
      account: "0xaaaaaaaa00000000000000000000000000000009",
      amount: 5_000_000n,
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      kind: "deposited",
      logIndex: 4,
      runningTotal: 12_000_000n,
      transactionHash: BASE_LOG.transactionHash,
    });
  });

  it("maps ReviewFeesSettled to a settled row carrying the consumed delta and lifetime consumption", () => {
    const record = build("settled", {
      consumedDelta: 1_000_000n,
      consumedTotal: 3_000_000n,
      user: USER,
    });

    expect(record.event).toMatchObject({
      account: USER.toLowerCase(),
      amount: 1_000_000n,
      kind: "settled",
      runningTotal: 3_000_000n,
    });
  });

  it("maps ReviewBondWithdrawn to a bond_withdrawn row carrying the remaining available bond", () => {
    const record = build("bond_withdrawn", {
      amount: 4_000_000n,
      remainingAvailable: 8_000_000n,
      user: USER,
    });

    expect(record.event).toMatchObject({
      account: USER.toLowerCase(),
      amount: 4_000_000n,
      kind: "bond_withdrawn",
      runningTotal: 8_000_000n,
    });
  });

  it("maps ReviewFeesWithdrawn to a fees_withdrawn row keyed on the sweep recipient with no running total", () => {
    const record = build("fees_withdrawn", {
      amount: 2_500_000n,
      recipient: RECIPIENT,
    });

    expect(record.event).toMatchObject({
      account: "0xbbbbbbbb00000000000000000000000000000007",
      amount: 2_500_000n,
      kind: "fees_withdrawn",
      // The sweep event reports no cumulative figure on-chain.
      runningTotal: null,
    });
  });

  it("throws when a user-scoped log is missing its user", () => {
    expect(() =>
      build("deposited", { amount: 1n, totalDeposited: 1n }),
    ).toThrow("user");
  });

  it("throws when the sweep log is missing its recipient", () => {
    expect(() => build("fees_withdrawn", { amount: 1n })).toThrow("recipient");
  });

  it("throws when a log is missing its kind-specific amount or running total", () => {
    expect(() => build("settled", { consumedTotal: 1n, user: USER })).toThrow(
      "consumedDelta",
    );
    expect(() => build("deposited", { amount: 1n, user: USER })).toThrow(
      "totalDeposited",
    );
    expect(() => build("bond_withdrawn", { amount: 1n, user: USER })).toThrow(
      "remainingAvailable",
    );
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildReviewBondRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "deposited",
        log: {
          ...BASE_LOG,
          args: { amount: 1n, totalDeposited: 1n, user: USER },
          transactionHash: null,
        } as unknown as ReviewBondDepositedLog,
      }),
    ).toThrow("transactionHash");
  });
});
