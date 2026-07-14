import { describe, expect, test } from "bun:test";
import {
  completeSetBinaryMarketAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import type { Abi } from "viem";

import { PREGRAD_DEV_GRADUATE_ABI } from "./dev-market-graduate";
import { POSTGRAD_DEV_RESOLVE_ABI } from "./dev-market-resolve";
import { PREGRAD_REFUND_ABI } from "./pregrad-refund";

// The dev/admin services keep small hand-written `parseAbi` mirrors of the
// contract surface they touch. Those mirrors drift silently when a contract
// struct changes (getMarketConfig gained `yesNotBefore` and every mirror kept
// decoding a timestamp as a bool), so pin each one to the generated ABI that
// `protocol/scripts/export-contract-metadata.ts` keeps in lockstep with the
// compiled contracts.

type AbiParameter = {
  readonly components?: readonly AbiParameter[];
  readonly indexed?: boolean;
  readonly type: string;
};

type NamedAbiItem = {
  readonly inputs?: readonly AbiParameter[];
  readonly name: string;
  readonly outputs?: readonly AbiParameter[];
  readonly type: string;
};

function canonicalType(parameter: AbiParameter): string {
  if (parameter.type.startsWith("tuple")) {
    const inner = (parameter.components ?? []).map(canonicalType).join(",");
    return `(${inner})${parameter.type.slice("tuple".length)}`;
  }

  return parameter.type;
}

function canonicalSignature(item: NamedAbiItem): string {
  const inputs = (item.inputs ?? [])
    .map(
      (parameter) =>
        `${canonicalType(parameter)}${parameter.indexed ? " indexed" : ""}`,
    )
    .join(",");

  if (item.type === "event") {
    return `event ${item.name}(${inputs})`;
  }

  const outputs = (item.outputs ?? []).map(canonicalType).join(",");

  return `function ${item.name}(${inputs}) returns (${outputs})`;
}

function expectMirrorsGeneratedAbi(mirror: Abi, generated: Abi) {
  const generatedSignatures = new Set(
    (generated as readonly NamedAbiItem[])
      .filter((item) => item.type === "function" || item.type === "event")
      .map(canonicalSignature),
  );

  for (const item of mirror as readonly NamedAbiItem[]) {
    if (item.type !== "function" && item.type !== "event") {
      continue;
    }

    expect(generatedSignatures).toContain(canonicalSignature(item));
  }
}

describe("hand-written contract ABI mirrors", () => {
  test("dev-market-graduate mirrors the generated PregradManager ABI", () => {
    expectMirrorsGeneratedAbi(PREGRAD_DEV_GRADUATE_ABI, pregradManagerAbi);
  });

  test("pregrad-refund mirrors the generated PregradManager ABI", () => {
    expectMirrorsGeneratedAbi(PREGRAD_REFUND_ABI, pregradManagerAbi);
  });

  test("dev-market-resolve mirrors the generated CompleteSetBinaryMarket ABI", () => {
    expectMirrorsGeneratedAbi(
      POSTGRAD_DEV_RESOLVE_ABI,
      completeSetBinaryMarketAbi,
    );
  });
});
