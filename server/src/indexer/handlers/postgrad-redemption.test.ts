import { describe, expect, it } from "bun:test";

import {
  buildPostgradRedemptionRecord,
  type PostgradCancelledRedeemedLog,
  type PostgradRedeemedLog,
} from "./postgrad-redemption";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const ACCOUNT = "0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266";

const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");

describe("buildPostgradRedemptionRecord", () => {
  it("maps Redeemed(side=0) to a redeemed event on side yes", () => {
    const record = buildPostgradRedemptionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "redeemed",
      log: {
        ...BASE_LOG,
        args: {
          account: ACCOUNT,
          collateralAmount: 250n,
          outcomeAmount: 1000n,
          side: 0,
        },
      } as PostgradRedeemedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      account: ACCOUNT.toLowerCase(),
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      collateralAmount: 250n,
      contractId: 42,
      kind: "redeemed",
      logIndex: 4,
      marketId: 7n,
      noAmount: null,
      outcomeAmount: 1000n,
      postgradMarket: BASE_LOG.address.toLowerCase(),
      side: "yes",
      yesAmount: null,
    });
  });

  it("maps Redeemed(side=1) to side no", () => {
    const record = buildPostgradRedemptionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "redeemed",
      log: {
        ...BASE_LOG,
        args: {
          account: ACCOUNT,
          collateralAmount: 250n,
          outcomeAmount: 1000n,
          side: 1,
        },
      } as PostgradRedeemedLog,
      marketId: 7n,
    });

    expect(record.event.side).toBe("no");
  });

  it("maps CancelledRedeemed to a draw redemption with both burn legs", () => {
    const record = buildPostgradRedemptionRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "cancelled_redeemed",
      log: {
        ...BASE_LOG,
        args: {
          account: ACCOUNT,
          collateralAmount: 300n,
          noAmount: 400n,
          yesAmount: 200n,
        },
      } as PostgradCancelledRedeemedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      collateralAmount: 300n,
      kind: "cancelled_redeemed",
      noAmount: 400n,
      outcomeAmount: null,
      side: null,
      yesAmount: 200n,
    });
  });

  it("throws when a redeemed log is missing its side", () => {
    expect(() =>
      buildPostgradRedemptionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "redeemed",
        log: {
          ...BASE_LOG,
          args: { account: ACCOUNT, collateralAmount: 1n, outcomeAmount: 1n },
        } as PostgradRedeemedLog,
        marketId: 7n,
      }),
    ).toThrow("side");
  });

  it("throws when a cancelled log is missing a burn leg", () => {
    expect(() =>
      buildPostgradRedemptionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "cancelled_redeemed",
        log: {
          ...BASE_LOG,
          args: { account: ACCOUNT, collateralAmount: 1n, yesAmount: 1n },
        } as PostgradCancelledRedeemedLog,
        marketId: 7n,
      }),
    ).toThrow("noAmount");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildPostgradRedemptionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "redeemed",
        log: {
          ...BASE_LOG,
          args: {
            account: ACCOUNT,
            collateralAmount: 1n,
            outcomeAmount: 1n,
            side: 0,
          },
          blockNumber: null,
        } as unknown as PostgradRedeemedLog,
        marketId: 7n,
      }),
    ).toThrow("blockNumber");
  });

  it("throws when the payout amount is missing", () => {
    expect(() =>
      buildPostgradRedemptionRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "redeemed",
        log: {
          ...BASE_LOG,
          args: { account: ACCOUNT, outcomeAmount: 1n, side: 0 },
        } as PostgradRedeemedLog,
        marketId: 7n,
      }),
    ).toThrow("collateralAmount");
  });
});
