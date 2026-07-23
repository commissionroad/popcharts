import {
  mockCollateralAbi,
  pregradManagerAbi,
  SIDE_NO,
  SIDE_YES,
} from "@popcharts/protocol";
import { maxUint256, parseEventLogs } from "viem";

import {
  collateralAddress,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "./stack";

const QUOTE_SLIPPAGE_BPS = 1_000n;

/**
 * Places one pregrad receipt from a trader account: quote, fund with freshly
 * minted dev collateral, approve, and buy. Returns the receipt id and its
 * actual on-chain cost (from the ReceiptPlaced event, not the quote) so
 * scenarios can claim it later and assert against the indexed paper trail.
 */
export async function placeReceipt({
  marketId,
  sharesWad,
  side,
  traderAccountIndex,
}: {
  marketId: bigint;
  sharesWad: bigint;
  side: number;
  traderAccountIndex: number;
}): Promise<{ cost: bigint; owner: `0x${string}`; receiptId: bigint }> {
  const wallet = walletFor(traderAccountIndex);

  const quote = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "quoteReceipt",
    args: [marketId, side, sharesWad],
  });
  const maxCost = quote.cost + (quote.cost * QUOTE_SLIPPAGE_BPS) / 10_000n;

  await fundTrader(wallet, maxCost);

  const transactionHash = await wallet.writeContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "placeReceipt",
    args: [{ marketId, maxCost, shares: sharesWad, side }],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`placeReceipt reverted: ${transactionHash}`);
  }

  const placed = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "ReceiptPlaced",
    logs: receipt.logs,
  }).find((log) => log.args.marketId === marketId);
  if (!placed) {
    throw new Error(
      `placeReceipt succeeded but no ReceiptPlaced event for market ${marketId}: ${transactionHash}`,
    );
  }

  return {
    cost: placed.args.cost,
    owner: wallet.account.address,
    receiptId: placed.args.receiptId,
  };
}

/**
 * Buys balanced YES/NO volume until the market can pass the real band-pass
 * graduation gate: yesShares, noShares, and total escrow all at or above the
 * graduation threshold (the same convergence rule the dev top-up uses —
 * buying X shares on both sides raises escrow by exactly X under LMSR). The
 * keeper's next graduation pass then settles the market with no force path
 * involved.
 */
export async function placeGraduationLiquidity({
  marketId,
  thresholdWad,
  yesTraderAccountIndex,
  noTraderAccountIndex,
}: {
  marketId: bigint;
  noTraderAccountIndex: number;
  thresholdWad: bigint;
  yesTraderAccountIndex: number;
}): Promise<{ receiptCount: number; totalCost: bigint }> {
  const MAX_ROUNDS = 4;
  let receiptCount = 0;
  let totalCost = 0n;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const state = await publicClient.readContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "getMarketState",
      args: [marketId],
    });
    const yesDeficit = clampToZero(thresholdWad - state.yesShares);
    const noDeficit = clampToZero(thresholdWad - state.noShares);
    const escrowDeficit = clampToZero(thresholdWad - state.totalEscrowed);

    if (yesDeficit === 0n && noDeficit === 0n && escrowDeficit === 0n) {
      return { receiptCount, totalCost };
    }

    const buys = [
      {
        shares: maxBigInt(yesDeficit, escrowDeficit),
        side: SIDE_YES,
        traderAccountIndex: yesTraderAccountIndex,
      },
      {
        shares: maxBigInt(noDeficit, escrowDeficit),
        side: SIDE_NO,
        traderAccountIndex: noTraderAccountIndex,
      },
    ].filter((buy) => buy.shares > 0n);

    for (const buy of buys) {
      const placed = await placeReceipt({
        marketId,
        sharesWad: buy.shares,
        side: buy.side,
        traderAccountIndex: buy.traderAccountIndex,
      });
      receiptCount += 1;
      totalCost += placed.cost;
    }
  }

  throw new Error(
    `Market ${marketId} did not reach its graduation threshold after ${MAX_ROUNDS} balanced buy rounds.`,
  );
}

/**
 * Claims a refunded receipt from its owner's account and returns the
 * collateral actually received, measured by balance delta rather than
 * trusted from any service.
 */
export async function claimRefundedReceipt({
  receiptId,
  traderAccountIndex,
}: {
  receiptId: bigint;
  traderAccountIndex: number;
}): Promise<{ refunded: bigint }> {
  const wallet = walletFor(traderAccountIndex);
  const balanceBefore = await publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [wallet.account.address],
  });

  const transactionHash = await wallet.writeContract({
    abi: pregradManagerAbi,
    address: pregradManagerAddress,
    functionName: "claimRefundedReceipt",
    args: [receiptId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`claimRefundedReceipt reverted: ${transactionHash}`);
  }

  const balanceAfter = await publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [wallet.account.address],
  });

  return { refunded: balanceAfter - balanceBefore };
}

/** Mints dev collateral for the trade and grants the manager allowance. */
async function fundTrader(
  wallet: ReturnType<typeof walletFor>,
  amount: bigint,
): Promise<void> {
  const mintHash = await wallet.writeContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "mint",
    args: [wallet.account.address, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  const allowance = await publicClient.readContract({
    abi: mockCollateralAbi,
    address: collateralAddress,
    functionName: "allowance",
    args: [wallet.account.address, pregradManagerAddress],
  });

  if (allowance < amount) {
    const approveHash = await wallet.writeContract({
      abi: mockCollateralAbi,
      address: collateralAddress,
      functionName: "approve",
      args: [pregradManagerAddress, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }
}

function clampToZero(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
