import { describe, expect, it } from "bun:test";

import {
  buildCompleteSetEventRecord,
  type CompleteSetsMergedLog,
  type CompleteSetsMintedLog,
} from "./complete-set-events";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const ACCOUNT = "0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266";
const OTHER = "0x70997970C51812DC3A010C7D01B50E0D17DC79C8";

const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");

describe("buildCompleteSetEventRecord", () => {
  it("maps CompleteSetsMinted to a minted event for the paying caller", () => {
    const record = buildCompleteSetEventRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "minted",
      log: {
        ...BASE_LOG,
        args: {
          caller: ACCOUNT,
          collateralAmount: 500n,
          outcomeAmount: 1000n,
          to: ACCOUNT,
        },
      } as CompleteSetsMintedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      account: ACCOUNT.toLowerCase(),
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      collateralAmount: 500n,
      contractId: 42,
      kind: "minted",
      logIndex: 4,
      marketId: 7n,
      outcomeAmount: 1000n,
      postgradMarket: BASE_LOG.address.toLowerCase(),
      recipient: null,
      transactionHash: BASE_LOG.transactionHash,
    });
  });

  it("attributes a sponsored mint to the payer and keeps the recipient", () => {
    const record = buildCompleteSetEventRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "minted",
      log: {
        ...BASE_LOG,
        args: {
          caller: OTHER,
          collateralAmount: 500n,
          outcomeAmount: 1000n,
          to: ACCOUNT,
        },
      } as CompleteSetsMintedLog,
      marketId: 7n,
    });

    expect(record.event.account).toBe(OTHER.toLowerCase());
    expect(record.event.recipient).toBe(ACCOUNT.toLowerCase());
  });

  it("maps CompleteSetsMerged to a merged event with a null recipient", () => {
    const record = buildCompleteSetEventRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "merged",
      log: {
        ...BASE_LOG,
        args: {
          account: ACCOUNT,
          collateralAmount: 250n,
          outcomeAmount: 250n,
        },
      } as CompleteSetsMergedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      account: ACCOUNT.toLowerCase(),
      collateralAmount: 250n,
      kind: "merged",
      outcomeAmount: 250n,
      recipient: null,
    });
  });

  it("throws when a minted log is missing its recipient", () => {
    expect(() =>
      buildCompleteSetEventRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "minted",
        log: {
          ...BASE_LOG,
          args: { caller: ACCOUNT, collateralAmount: 1n, outcomeAmount: 1n },
        } as CompleteSetsMintedLog,
        marketId: 7n,
      }),
    ).toThrow("to");
  });

  it("throws when a merged log is missing its account", () => {
    expect(() =>
      buildCompleteSetEventRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "merged",
        log: {
          ...BASE_LOG,
          args: { collateralAmount: 1n, outcomeAmount: 1n },
        } as CompleteSetsMergedLog,
        marketId: 7n,
      }),
    ).toThrow("account");
  });

  it("throws when the collateral amount is missing", () => {
    expect(() =>
      buildCompleteSetEventRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "merged",
        log: {
          ...BASE_LOG,
          args: { account: ACCOUNT, outcomeAmount: 1n },
        } as CompleteSetsMergedLog,
        marketId: 7n,
      }),
    ).toThrow("collateralAmount");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildCompleteSetEventRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "merged",
        log: {
          ...BASE_LOG,
          args: { account: ACCOUNT, collateralAmount: 1n, outcomeAmount: 1n },
          blockNumber: null,
        } as unknown as CompleteSetsMergedLog,
        marketId: 7n,
      }),
    ).toThrow("blockNumber");
  });
});
