import { describe, expect, it } from "bun:test";

import {
  buildClearingRootSubmittedRecord,
  buildGraduatedReceiptClaimedRecord,
  buildGraduationFinalizedRecord,
  buildGraduationStartedRecord,
  buildMarketRefundsAvailableRecord,
  buildRefundedReceiptClaimedRecord,
  type ClearingRootSubmittedLog,
  type GraduatedReceiptClaimedLog,
  type GraduationFinalizedLog,
  type GraduationStartedLog,
  type MarketRefundsAvailableLog,
  type RefundedReceiptClaimedLog,
} from "./settlement";

const blockTimestamp = new Date("2026-06-22T12:00:00.000Z");
const config = { chainId: 5042002 };
const contractId = 3;

describe("settlement event record builders", () => {
  it("maps a GraduationStarted log into a typed record", () => {
    const log = baseLog({
      graduationStartedAt: 1_782_144_000n,
      manager: "0x00000000000000000000000000000000000000AA",
      marketId: 7n,
      noShares: 12n,
      path: -5n,
      receiptCount: 4n,
      snapshotHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      totalEscrowed: 100n,
      yesShares: 17n,
    }) as GraduationStartedLog;

    expect(
      buildGraduationStartedRecord({
        blockTimestamp,
        config,
        contractId,
        log,
      }),
    ).toEqual({
      blockNumber: 99n,
      blockTimestamp,
      chainId: 5042002,
      contractId,
      graduationStartedAt: new Date("2026-06-22T16:00:00.000Z"),
      graduationStartedAtUnix: 1_782_144_000n,
      logIndex: 2,
      manager: "0x00000000000000000000000000000000000000aa",
      marketId: 7n,
      noShares: 12n,
      path: "-5",
      receiptCount: 4n,
      snapshotHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      totalEscrowed: 100n,
      transactionHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      yesShares: 17n,
    });
  });

  it("maps clearing and finalization logs", () => {
    const clearingLog = baseLog({
      challengeDeadline: 1_782_147_600n,
      completeSetCount: 40n,
      marketId: 7n,
      matchedMarketCap: 40n,
      merkleRoot:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      refundTotal: 9n,
      retainedCostTotal: 40n,
      snapshotHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submittedAt: 1_782_144_000n,
      submitter: "0x00000000000000000000000000000000000000BB",
    }) as ClearingRootSubmittedLog;
    const finalizedLog = baseLog({
      completeSetCount: 40n,
      marketId: 7n,
      postgradAdapter: "0x00000000000000000000000000000000000000CC",
      postgradMarket: "0x00000000000000000000000000000000000000DD",
      refundTotal: 9n,
      retainedCostTotal: 40n,
    }) as GraduationFinalizedLog;

    expect(
      buildClearingRootSubmittedRecord({
        blockTimestamp,
        config,
        contractId,
        log: clearingLog,
      }),
    ).toMatchObject({
      challengeDeadline: new Date("2026-06-22T17:00:00.000Z"),
      completeSetCount: 40n,
      matchedMarketCap: 40n,
      refundTotal: 9n,
      retainedCostTotal: 40n,
      submittedAt: new Date("2026-06-22T16:00:00.000Z"),
      submitter: "0x00000000000000000000000000000000000000bb",
    });
    expect(
      buildGraduationFinalizedRecord({
        blockTimestamp,
        config,
        contractId,
        log: finalizedLog,
      }),
    ).toMatchObject({
      completeSetCount: 40n,
      marketId: 7n,
      postgradAdapter: "0x00000000000000000000000000000000000000cc",
      postgradMarket: "0x00000000000000000000000000000000000000dd",
      refundTotal: 9n,
      retainedCostTotal: 40n,
    });
  });

  it("maps refund and claim logs", () => {
    const refundsAvailableLog = baseLog({
      marketId: 7n,
      totalEscrowed: 25n,
    }) as MarketRefundsAvailableLog;
    const graduatedClaimLog = baseLog({
      marketId: 7n,
      owner: "0x00000000000000000000000000000000000000DD",
      receiptId: 11n,
      refund: 5n,
      retainedCost: 20n,
      retainedShares: 20n,
      side: 0,
    }) as GraduatedReceiptClaimedLog;
    const refundedClaimLog = baseLog({
      marketId: 7n,
      owner: "0x00000000000000000000000000000000000000EE",
      receiptId: 12n,
      refund: 25n,
    }) as RefundedReceiptClaimedLog;

    expect(
      buildMarketRefundsAvailableRecord({
        blockTimestamp,
        config,
        contractId,
        log: refundsAvailableLog,
      }),
    ).toMatchObject({ marketId: 7n, totalEscrowed: 25n });
    expect(
      buildGraduatedReceiptClaimedRecord({
        blockTimestamp,
        config,
        contractId,
        log: graduatedClaimLog,
      }),
    ).toMatchObject({
      owner: "0x00000000000000000000000000000000000000dd",
      receiptId: 11n,
      refund: 5n,
      retainedCost: 20n,
      retainedShares: 20n,
      side: 0,
    });
    expect(
      buildRefundedReceiptClaimedRecord({
        blockTimestamp,
        config,
        contractId,
        log: refundedClaimLog,
      }),
    ).toMatchObject({
      owner: "0x00000000000000000000000000000000000000ee",
      receiptId: 12n,
      refund: 25n,
    });
  });

  it("throws when required settlement log metadata is missing", () => {
    const log = baseLog({
      graduationStartedAt: 1_782_144_000n,
      manager: "0x00000000000000000000000000000000000000AA",
    });

    expect(() =>
      buildGraduationStartedRecord({
        blockTimestamp,
        config,
        contractId,
        log: log as GraduationStartedLog,
      }),
    ).toThrow("marketId");
  });
});

function baseLog(args: Record<string, unknown>) {
  return {
    args,
    blockNumber: 99n,
    logIndex: 2,
    transactionHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
}
