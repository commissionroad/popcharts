import { mockCollateralAbi, pregradManagerAbi, WAD } from "@popcharts/protocol";
import type { Address } from "viem";

import { schema } from "src/db/client";

import { assertEqual, assertTruthy } from "../asserts";
import {
  collateralAddress,
  pregradManagerAddress,
  publicClient,
} from "../stack";

/**
 * Shared fee arithmetic, row assertions, and on-chain reads for the
 * entry-fee scenario's two settlement paths (protocol ADR 0014 P4a). Kept
 * beside the path modules so the whole entry-fee cluster reads as one unit.
 */

/** 1% in WAD (1e16) — well under the contract's 10% hard cap. */
export const ENTRY_FEE_RATE_WAD = WAD / 100n;

export type FeeRow = typeof schema.receiptEntryFeeEvents.$inferSelect;

/**
 * The contract's fee arithmetic re-derived: `entryFeeFor` is
 * Math.mulDiv(cost, rate, WAD) — full-precision floor division, which plain
 * bigint arithmetic reproduces exactly.
 */
export function expectedEntryFee(cost: bigint): bigint {
  return (cost * ENTRY_FEE_RATE_WAD) / WAD;
}

export function feeRowsOf(
  rows: readonly FeeRow[],
  receiptId: bigint,
  kind: FeeRow["kind"],
): FeeRow[] {
  return rows.filter((row) => row.receiptId === receiptId && row.kind === kind);
}

/** Exactly one row of `kind` for the receipt, with exact amount and account. */
export function assertSingleFeeRow(
  label: string,
  rows: readonly FeeRow[],
  expected: {
    account: string | null;
    amount: bigint;
    kind: FeeRow["kind"];
    receiptId: bigint;
  },
): void {
  const matching = feeRowsOf(rows, expected.receiptId, expected.kind);
  assertEqual(
    `${label} for receipt ${expected.receiptId}: row count`,
    matching.length,
    1,
  );
  const row = assertTruthy(
    `${label} for receipt ${expected.receiptId}`,
    matching[0],
  );
  assertEqual(
    `${label} for receipt ${expected.receiptId}: amount`,
    row.amount,
    expected.amount,
  );
  assertEqual(
    `${label} for receipt ${expected.receiptId}: account`,
    row.account,
    expected.account,
  );
}

export async function collateralBalanceOf(holder: Address): Promise<bigint> {
  return publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [holder],
  });
}

/** The fee still held refundable for the market (the second escrow). */
export async function readFeeEscrow(marketId: bigint): Promise<bigint> {
  return publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketEntryFeeEscrow",
    args: [marketId],
  });
}

/** The fee the market's graduated claims have earned for the protocol. */
export async function readFeesEarned(marketId: bigint): Promise<bigint> {
  return publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "marketEntryFeesEarned",
    args: [marketId],
  });
}

/** The manager's live rate — what the NEXT placement would be charged. */
export async function readEntryFeeRateWad(): Promise<bigint> {
  return publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "entryFeeRateWad",
  });
}
