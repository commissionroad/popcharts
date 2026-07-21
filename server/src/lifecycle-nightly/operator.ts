import {
  completeSetBinaryMarketAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import { BaseError, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readReviewManagerPrivateKey } from "src/ai-review-runner/chain-review";
import { createWalletClient } from "src/blockchain/client";

import {
  LOCAL_DEV_ACCOUNT_COUNT,
  pregradManagerAddress,
  publicClient,
  walletFor,
} from "./stack";

/**
 * Operator actions for lifecycle scenarios. Operator moves are keyed direct
 * contract calls — never API endpoints — mirroring the real operator model
 * (dev/admin endpoints are excluded from prod builds; operators act with a
 * local key). Both signers here are service-shared accounts, so writes race
 * service nonces in a narrow window; retryOnceOnNonceCollision absorbs the
 * rare collision instead of failing the nightly.
 */

/**
 * Approves an under_review market as the review manager, resolving the key
 * exactly the way the review runner does (its env-override chain), so the
 * harness approves as the same identity on any stack the runner works on.
 * This is the manual-review scenario's "operator approves via admin path"
 * step.
 */
export async function approveMarketAsReviewManager(
  marketId: bigint,
): Promise<void> {
  const manager = createWalletClient(
    privateKeyToAccount(readReviewManagerPrivateKey()),
  );

  const transactionHash = await retryOnceOnNonceCollision(() =>
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

  const transactionHash = await retryOnceOnNonceCollision(() =>
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

/**
 * Hardhat surfaces a same-nonce race as "nonce too low", "replacement
 * transaction underpriced", or "already known" — sometimes only on a nested
 * cause — so the match walks the full error chain.
 */
const NONCE_COLLISION_PATTERN =
  /nonce|replacement transaction underpriced|already known/i;

function isNonceCollision(error: unknown): boolean {
  if (error instanceof BaseError) {
    return (
      error.walk(
        (cause) =>
          cause instanceof Error && NONCE_COLLISION_PATTERN.test(cause.message),
      ) !== null
    );
  }
  return error instanceof Error && NONCE_COLLISION_PATTERN.test(error.message);
}

async function retryOnceOnNonceCollision<T>(
  send: () => Promise<T>,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!isNonceCollision(error)) {
      throw error;
    }
    return await send();
  }
}
