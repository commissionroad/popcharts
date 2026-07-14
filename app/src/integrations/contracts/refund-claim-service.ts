import type { PublicClient, WalletClient } from "viem";
import { parseEventLogs } from "viem";

import { presentError } from "@/lib/error-handling";

import type { PopChartsContractConfig } from "./config";
import { pregradManagerAbi } from "./pregrad-manager";

/**
 * Connected wallet context required to claim a refunded receipt: the signing
 * account, its active chain, and viem clients bound to the devchain.
 */
export type RefundClaimWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * Result of a settled refund claim: the on-chain refund amount (WAD collateral,
 * from the `RefundedReceiptClaimed` event) and the confirming transaction hash.
 */
export type RefundClaimResult = {
  refund: bigint;
  transactionHash: `0x${string}`;
};

/**
 * Claims a full refund for one receipt on a refunded or cancelled market: the
 * bettor calls `claimRefundedReceipt` with their own wallet, and the escrowed
 * collateral is returned to `receipt.owner`. Waits for the transaction, then
 * confirms the matching `RefundedReceiptClaimed` event before resolving so a
 * caller never treats a reverted or unrelated transaction as a successful
 * claim.
 */
export async function submitRefundClaim({
  config,
  receiptId,
  wallet,
}: {
  config: PopChartsContractConfig;
  receiptId: bigint;
  wallet: RefundClaimWallet;
}): Promise<RefundClaimResult> {
  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId}.`);
  }

  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "claimRefundedReceipt",
    args: [receiptId],
  });

  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const claimedLogs = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "RefundedReceiptClaimed",
    logs: transactionReceipt.logs,
  });
  const claimed = claimedLogs.find((log) => log.args.receiptId === receiptId);

  if (!claimed) {
    throw new Error(
      "Transaction succeeded but RefundedReceiptClaimed was not emitted."
    );
  }

  return { refund: claimed.args.refund, transactionHash: hash };
}

/**
 * Translates a refund-claim failure into user-facing copy, mapping the
 * already-claimed revert (a stale row the indexer has not yet projected as
 * `refunded`) to a plain explanation instead of a raw selector.
 */
export function getRefundClaimErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "refund-claim" },
    fallback: "Could not claim your refund.",
    matcher: (claimError) =>
      claimError.message.includes("ReceiptAlreadyClaimed") ||
      claimError.message.includes("AlreadyClaimed")
        ? "This refund has already been claimed. Refresh to see the updated status."
        : undefined,
  });
}
