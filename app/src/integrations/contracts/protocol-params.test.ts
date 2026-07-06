import { describe, expect, it } from "vitest";

import type { ProtocolCreateMarketParams } from "@/domain/market-creation/types";

import {
  parseSerializedProtocolCreateMarketParams,
  serializeProtocolCreateMarketParams,
} from "./protocol-params";

const params: ProtocolCreateMarketParams = {
  bypassAiResolution: false,
  collateral: "0x1111111111111111111111111111111111111111",
  graduationDeadline: 1_785_542_400n,
  graduationThreshold: 100_000_000_000_000_000_000n,
  liquidityParameter: 5_000_000_000_000_000_000_000n,
  metadata: '{"version":1}',
  metadataHash: `0x${"ab".repeat(32)}`,
  openingProbabilityWad: 500_000_000_000_000_000n,
  resolutionTime: 1_785_628_800n,
};

describe("serializeProtocolCreateMarketParams", () => {
  it("stringifies every bigint field", () => {
    const serialized = serializeProtocolCreateMarketParams(params);

    expect(serialized).toEqual({
      bypassAiResolution: false,
      collateral: params.collateral,
      graduationDeadline: "1785542400",
      graduationThreshold: "100000000000000000000",
      liquidityParameter: "5000000000000000000000",
      metadata: '{"version":1}',
      metadataHash: params.metadataHash,
      openingProbabilityWad: "500000000000000000",
      resolutionTime: "1785628800",
    });
  });

  it("round-trips through the parser", () => {
    expect(
      parseSerializedProtocolCreateMarketParams(
        serializeProtocolCreateMarketParams(params)
      )
    ).toEqual(params);
  });
});

describe("parseSerializedProtocolCreateMarketParams", () => {
  it("rejects non-object payloads", () => {
    for (const value of [null, undefined, "params", 42]) {
      expect(() => parseSerializedProtocolCreateMarketParams(value)).toThrow(
        "Expected protocolParams object."
      );
    }
  });

  it("checksums the collateral address", () => {
    const parsed = parseSerializedProtocolCreateMarketParams(
      serialized({ collateral: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" })
    );

    expect(parsed.collateral).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });

  it("rejects malformed addresses", () => {
    for (const collateral of ["0x123", "not-an-address", 42, undefined]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ collateral }))
      ).toThrow("Invalid collateral.");
    }
  });

  it("rejects malformed metadata hashes", () => {
    for (const metadataHash of ["0x1234", `0x${"zz".repeat(32)}`, 42, undefined]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ metadataHash }))
      ).toThrow("Invalid metadataHash.");
    }
  });

  it("rejects empty metadata", () => {
    for (const metadata of ["", 42, undefined]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ metadata }))
      ).toThrow("Invalid metadata.");
    }
  });

  it("rejects bigint fields that are not decimal strings", () => {
    for (const graduationDeadline of ["-1", "1.5", "0x10", "1e18", "", 1785542400]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ graduationDeadline }))
      ).toThrow("Invalid graduationDeadline.");
    }
  });

  it("names each invalid bigint field in its error", () => {
    for (const field of [
      "graduationThreshold",
      "liquidityParameter",
      "openingProbabilityWad",
      "resolutionTime",
    ]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ [field]: "nope" }))
      ).toThrow(`Invalid ${field}.`);
    }
  });

  it("rejects non-boolean bypass flags", () => {
    for (const bypassAiResolution of ["true", 1, undefined]) {
      expect(() =>
        parseSerializedProtocolCreateMarketParams(serialized({ bypassAiResolution }))
      ).toThrow("Invalid bypassAiResolution.");
    }
  });
});

function serialized(overrides: Record<string, unknown> = {}) {
  return { ...serializeProtocolCreateMarketParams(params), ...overrides };
}
