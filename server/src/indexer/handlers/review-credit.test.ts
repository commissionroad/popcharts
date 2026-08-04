import { describe, expect, it } from "bun:test";

import {
  buildReviewCreditRecord,
  type ReviewCreditDepositedLog,
  type ReviewCreditLog,
} from "./review-credit";

const USER = "0xAAAAAAAA00000000000000000000000000000009";
const PAYER = "0xCCCCCCCC00000000000000000000000000000003";
const RECIPIENT = "0xBBBBBBBB00000000000000000000000000000007";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const blockTimestamp = new Date("2026-07-30T12:00:00.000Z");

function build(
  kind: Parameters<typeof buildReviewCreditRecord>[0]["kind"],
  args: object,
) {
  return buildReviewCreditRecord({
    blockTimestamp,
    config: { chainId: 5042002 },
    contractId: 42,
    kind,
    log: { ...BASE_LOG, args } as ReviewCreditLog,
  });
}

describe("buildReviewCreditRecord", () => {
  it("maps ReviewCreditDeposited to a deposited row keyed on the lowercased beneficiary, not the payer", () => {
    const record = build("deposited", {
      amount: 5_000_000n,
      payer: PAYER,
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
      payer: "0xcccccccc00000000000000000000000000000003",
      runningTotal: 12_000_000n,
      transactionHash: BASE_LOG.transactionHash,
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
      // The sweep event reports no payer or cumulative figure on-chain.
      payer: null,
      runningTotal: null,
    });
  });

  it("throws when a deposit log is missing its beneficiary", () => {
    expect(() =>
      build("deposited", { amount: 1n, payer: PAYER, totalDeposited: 1n }),
    ).toThrow("user");
  });

  it("throws when a deposit log is missing its payer", () => {
    expect(() =>
      build("deposited", { amount: 1n, totalDeposited: 1n, user: USER }),
    ).toThrow("payer");
  });

  it("throws when the sweep log is missing its recipient", () => {
    expect(() => build("fees_withdrawn", { amount: 1n })).toThrow("recipient");
  });

  it("throws when a deposit log is missing its running total", () => {
    expect(() =>
      build("deposited", { amount: 1n, payer: PAYER, user: USER }),
    ).toThrow("totalDeposited");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildReviewCreditRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "deposited",
        log: {
          ...BASE_LOG,
          args: { amount: 1n, payer: PAYER, totalDeposited: 1n, user: USER },
          transactionHash: null,
        } as unknown as ReviewCreditDepositedLog,
      }),
    ).toThrow("transactionHash");
  });
});
