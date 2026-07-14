import type { PublicClient, WalletClient } from "viem";
import { parseEventLogs } from "viem";

import type { MarketSide } from "@/domain/markets/types";
import { presentError } from "@/lib/error-handling";

import type { PopChartsContractConfig } from "./config";
import { completeSetBinaryMarketAbi } from "./postgrad-venue";

/**
 * Connected wallet context required to redeem winning outcome tokens: the
 * signing account, its active chain, and viem clients bound to the devchain.
 */
export type RedemptionWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * Result of a settled redemption: the tokens burned, the collateral paid out
 * (raw collateral units, from the `Redeemed` event), and the confirming
 * transaction hash.
 */
export type RedemptionResult = {
  collateralAmount: bigint;
  outcomeAmount: bigint;
  transactionHash: `0x${string}`;
};

/**
 * Smallest winning balance (outcome-token WAD) a claim surface should offer a
 * button for: one cent. Below this the amount both displays as $0.00 and, on
 * low-precision collateral (6-decimal on Arc, conversion factor 1e12), can
 * round down to zero redeemable — a button that could only ever revert. The
 * one-cent floor (1e16) strictly dominates that dust factor on every
 * supported collateral, so callers need no chain read to apply it.
 */
export const MIN_REDEEMABLE_OUTCOME_WAD = 10n ** 16n;

/** MarketTypes.Side encodes YES as 0 and NO as 1. */
function sideToContractSide(side: MarketSide): number {
  return side === "yes" ? 0 : 1;
}

/**
 * Rounds a redeem amount down to what the market can convert to collateral
 * without dust: outcome tokens are 18-decimal while collateral can be
 * lower-precision (6-decimal on Arc), and `redeem` reverts with
 * `AmountHasDust` on a remainder rather than silently truncating the payout.
 */
export async function readRedeemableAmount({
  amount,
  marketAddress,
  publicClient,
}: {
  amount: bigint;
  marketAddress: `0x${string}`;
  publicClient: PublicClient;
}): Promise<bigint> {
  const [collateralDecimals, outcomeDecimals] = await Promise.all([
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: marketAddress,
      functionName: "collateralDecimals",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: marketAddress,
      functionName: "outcomeDecimals",
    }),
  ]);

  if (outcomeDecimals <= collateralDecimals) {
    return amount;
  }

  const factor = 10n ** BigInt(outcomeDecimals - collateralDecimals);

  return amount - (amount % factor);
}

/**
 * Redeems winning-side outcome tokens 1:1 for collateral on a resolved
 * postgrad market: the holder calls `redeem` with their own wallet and the
 * market burns the tokens (the market is the token's authorized burner, so no
 * approval step exists) and pays the collateral out. Waits for the
 * transaction, then confirms the matching `Redeemed` event before resolving so
 * a caller never treats a reverted or unrelated transaction as a successful
 * claim.
 */
export async function submitRedemption({
  amount,
  config,
  marketAddress,
  side,
  wallet,
}: {
  amount: bigint;
  config: PopChartsContractConfig;
  marketAddress: `0x${string}`;
  side: MarketSide;
  wallet: RedemptionWallet;
}): Promise<RedemptionResult> {
  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId}.`);
  }

  const redeemable = await readRedeemableAmount({
    amount,
    marketAddress,
    publicClient: wallet.publicClient,
  });

  if (redeemable <= 0n) {
    throw new Error("Nothing to redeem for this position.");
  }

  const hash = await wallet.walletClient.writeContract({
    abi: completeSetBinaryMarketAbi,
    account: wallet.accountAddress,
    address: marketAddress,
    chain: wallet.walletClient.chain,
    functionName: "redeem",
    args: [sideToContractSide(side), redeemable],
  });

  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const redeemedLogs = parseEventLogs({
    abi: completeSetBinaryMarketAbi,
    eventName: "Redeemed",
    logs: transactionReceipt.logs,
  });
  const redeemed = redeemedLogs.find(
    (log) => log.args.account.toLowerCase() === wallet.accountAddress.toLowerCase()
  );

  if (!redeemed) {
    throw new Error("Transaction succeeded but Redeemed was not emitted.");
  }

  return {
    collateralAmount: redeemed.args.collateralAmount,
    outcomeAmount: redeemed.args.outcomeAmount,
    transactionHash: hash,
  };
}

/**
 * Translates a redemption failure into user-facing copy, mapping the reverts a
 * holder can realistically hit — a stale winning side, a market whose indexed
 * status ran ahead of the chain, or an amount the pool cannot pay — to plain
 * explanations instead of raw selectors.
 */
export function getRedemptionErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "redemption-claim" },
    fallback: "Could not claim your winnings.",
    matcher: (redemptionError) => {
      if (redemptionError.message.includes("LosingSideCannotRedeem")) {
        return "These tokens are on the losing side, so they cannot be redeemed.";
      }

      if (redemptionError.message.includes("InvalidStatus")) {
        return "This market is not redeemable on-chain yet. Refresh to see the updated status.";
      }

      return undefined;
    },
  });
}
