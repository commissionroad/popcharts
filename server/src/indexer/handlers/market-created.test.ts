import { describe, expect, it } from "bun:test";

import {
  buildMarketCreatedRecords,
  type MarketCreatedLog,
} from "./market-created";

describe("buildMarketCreatedRecords", () => {
  it("maps a MarketCreated log into raw event and market projection rows", () => {
    const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");
    const log = {
      args: {
        bypassAiResolution: true,
        collateral: "0x0000000000000000000000000000000000000002",
        creator: "0x00000000000000000000000000000000000000AA",
        graduationThreshold: 2_500n * 10n ** 18n,
        graduationTime: 1_780_000_000n,
        liquidityParameter: 5_000n * 10n ** 18n,
        marketId: 7n,
        metadataHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        openingProbabilityWad: 500_000_000_000_000_000n,
        resolutionTime: 1_781_000_000n,
      },
      blockNumber: 123n,
      logIndex: 4,
      transactionHash:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
    } as unknown as MarketCreatedLog;

    const records = buildMarketCreatedRecords({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      log,
    });

    expect(records.event).toMatchObject({
      blockNumber: 123n,
      blockTimestamp,
      bypassAiResolution: true,
      chainId: 5042002,
      collateral: "0x0000000000000000000000000000000000000002",
      contractId: 42,
      creator: "0x00000000000000000000000000000000000000aa",
      logIndex: 4,
      marketId: 7n,
      transactionHash:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
    expect(records.market).toMatchObject({
      chainId: 5042002,
      contractId: 42,
      createdBlockNumber: 123n,
      createdBlockTimestamp: blockTimestamp,
      bypassAiResolution: true,
      marketId: 7n,
      metadataHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      status: "under_review",
    });
    expect(records.event.graduationTime.toISOString()).toBe(
      "2026-05-28T20:26:40.000Z",
    );
    expect(records.event.resolutionTime.toISOString()).toBe(
      "2026-06-09T10:13:20.000Z",
    );
  });

  it("throws when required log metadata is missing", () => {
    const log = {
      args: {},
      blockNumber: null,
      logIndex: 0,
      transactionHash:
        "0x2222222222222222222222222222222222222222222222222222222222222222",
    } as unknown as MarketCreatedLog;

    expect(() =>
      buildMarketCreatedRecords({
        blockTimestamp: new Date("2026-06-13T12:00:00.000Z"),
        config: { chainId: 5042002 },
        contractId: 42,
        log,
      }),
    ).toThrow("blockNumber");
  });
});
