import type { Hex, PublicClient, TransactionReceipt } from "viem";

/**
 * Waits for a transaction receipt and fails fast when the transaction
 * reverted, so smoke flows never continue on top of a silently failed write.
 */
export async function requireSuccessfulReceipt(
  publicClient: PublicClient,
  hash: Hex,
  label: string,
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${label} (${hash}) reverted.`);
  }
  return receipt;
}
