import { describe, expect, it } from "bun:test";

import {
  buildPostgradDisputeBondRecord,
  type PostgradDisputeBondLog,
} from "./postgrad-dispute-bond";

const DISPUTER = "0xAAAAAAAA00000000000000000000000000000009";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  args: { amount: 100_000_000n, disputer: DISPUTER },
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");

function buildBond(kind: "posted" | "refunded" | "forfeited") {
  return buildPostgradDisputeBondRecord({
    blockTimestamp,
    config: { chainId: 5042002 },
    contractId: 42,
    kind,
    log: { ...BASE_LOG } as PostgradDisputeBondLog,
    marketId: 7n,
  });
}

describe("buildPostgradDisputeBondRecord", () => {
  it("maps DisputeBondPosted to a posted row with the lowercased disputer", () => {
    expect(buildBond("posted").event).toMatchObject({
      amount: 100_000_000n,
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      disputer: "0xaaaaaaaa00000000000000000000000000000009",
      kind: "posted",
      logIndex: 4,
      marketId: 7n,
      postgradMarket: BASE_LOG.address.toLowerCase(),
      transactionHash: BASE_LOG.transactionHash,
    });
  });

  it("distinguishes the bond movements only by kind", () => {
    // All three logs carry the same (disputer, amount) pair, so the kind is
    // the only thing that says which way the collateral moved.
    expect(buildBond("refunded").event.kind).toBe("refunded");
    expect(buildBond("forfeited").event.kind).toBe("forfeited");
    expect(buildBond("forfeited").event.amount).toBe(100_000_000n);
  });

  it("throws when the log is missing its amount", () => {
    expect(() =>
      buildPostgradDisputeBondRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "posted",
        log: {
          ...BASE_LOG,
          args: { disputer: DISPUTER },
        } as PostgradDisputeBondLog,
        marketId: 7n,
      }),
    ).toThrow("amount");
  });

  it("throws when the log is missing its disputer", () => {
    expect(() =>
      buildPostgradDisputeBondRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "posted",
        log: {
          ...BASE_LOG,
          args: { amount: 1n },
        } as PostgradDisputeBondLog,
        marketId: 7n,
      }),
    ).toThrow("disputer");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildPostgradDisputeBondRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "posted",
        log: {
          ...BASE_LOG,
          transactionHash: null,
        } as unknown as PostgradDisputeBondLog,
        marketId: 7n,
      }),
    ).toThrow("transactionHash");
  });
});
