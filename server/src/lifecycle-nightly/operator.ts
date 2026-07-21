import {
  completeSetBinaryMarketAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import type { Address } from "viem";

import { pregradManagerAddress, publicClient, walletFor } from "./stack";

/**
 * Operator actions for lifecycle scenarios. Operator moves are keyed direct
 * contract calls — never API endpoints — mirroring the real operator model
 * (dev/admin endpoints are excluded from prod builds; operators act with a
 * local key). Both signers here are service-shared accounts, so writes race
 * service nonces in a narrow window; retryOnceOnNonceError absorbs the rare
 * collision instead of failing the nightly.
 */

const LOCAL_DEV_ACCOUNT_COUNT = 20;

/**
 * Approves an under_review market as the review manager (the dev key,
 * account 0 — the same identity the review runner signs with). This is the
 * manual-review scenario's "operator approves via admin path" step.
 */
export async function approveMarketAsReviewManager(
  marketId: bigint,
): Promise<void> {
  const manager = walletFor(0);

  const transactionHash = await retryOnceOnNonceError(() =>
    manager.writeContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "approveMarket",
      args: [marketId],
    }),
  );
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`approveMarket reverted: ${transactionHash}`);
  }
}

/**
 * Cancels a postgrad market (the draw outcome) with its on-chain resolver
 * key, located among the local dev accounts the way an operator would look
 * it up.
 */
export async function cancelPostgradMarketAsResolver(
  postgradMarketAddress: Address,
): Promise<void> {
  const resolver = (await publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: postgradMarketAddress,
    functionName: "resolver",
  })) as Address;

  let resolverWallet: ReturnType<typeof walletFor> | null = null;
  for (let index = 0; index < LOCAL_DEV_ACCOUNT_COUNT; index += 1) {
    const wallet = walletFor(index);
    if (wallet.account.address.toLowerCase() === resolver.toLowerCase()) {
      resolverWallet = wallet;
      break;
    }
  }
  if (!resolverWallet) {
    throw new Error(
      `Postgrad resolver ${resolver} is not a local dev account; cannot cancel.`,
    );
  }

  const transactionHash = await retryOnceOnNonceError(() =>
    resolverWallet.writeContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "cancel",
      args: [],
    }),
  );
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`postgrad cancel reverted: ${transactionHash}`);
  }
}

async function retryOnceOnNonceError<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/nonce/i.test(message)) {
      throw error;
    }
    return await send();
  }
}
