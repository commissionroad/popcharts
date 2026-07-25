import {
  completeSetBinaryMarketAbi,
  completeSetPostgradAdapterAbi,
  pregradManagerAbi,
} from "@popcharts/protocol";
import { BaseError, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readReviewManagerPrivateKey } from "src/ai-review-runner/chain-review";
import { createWalletClient } from "src/blockchain/client";

import {
  LOCAL_DEV_ACCOUNT_COUNT,
  postgradAdapterAddress,
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

  await sendOperatorTransaction("approveMarket", () =>
    manager.writeContract({
      abi: pregradManagerAbi,
      address: pregradManagerAddress,
      functionName: "approveMarket",
      args: [marketId],
    }),
  );
}

/**
 * Cancels a postgrad market (the draw outcome) with its on-chain resolver
 * key, located among the local dev accounts the way an operator would look
 * it up.
 */
export async function cancelPostgradMarketAsResolver(
  postgradMarketAddress: Address,
): Promise<void> {
  const resolver = await resolverWalletFor(postgradMarketAddress);

  await sendOperatorTransaction("postgrad cancel", () =>
    resolver.writeContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarketAddress,
      functionName: "cancel",
      args: [],
    }),
  );
}

/** Dispute parameters the adapter stamps into each market at graduation. */
export type PostgradDisputeConfig = {
  disputeBond: bigint;
  disputeWindow: bigint;
};

/**
 * Retunes the adapter's dispute parameters as its owner and returns the values
 * it replaced, so a scenario can restore them.
 *
 * Local stacks deploy the adapter with both set to zero, which degenerates to
 * the single-step resolve path — a scenario that needs a real dispute window
 * retunes the adapter before graduating its own market rather than changing
 * that global default, since the values are stamped per market at graduation
 * and markets already deployed keep theirs.
 */
export async function setPostgradDisputeConfig(
  next: PostgradDisputeConfig,
): Promise<PostgradDisputeConfig> {
  const [owner, disputeBond, disputeWindow] = await Promise.all([
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "owner",
    }),
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "disputeBond",
    }),
    publicClient.readContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "disputeWindow",
    }),
  ]);
  const ownerWallet = localWalletFor(
    owner as Address,
    "postgrad adapter owner",
  );

  await sendOperatorTransaction("setDisputeConfig", () =>
    ownerWallet.writeContract({
      abi: completeSetPostgradAdapterAbi,
      address: postgradAdapterAddress,
      functionName: "setDisputeConfig",
      args: [next.disputeWindow, next.disputeBond],
    }),
  );

  return { disputeBond, disputeWindow: BigInt(disputeWindow) };
}

/** The local dev wallet holding a market's on-chain resolver role. */
async function resolverWalletFor(postgradMarketAddress: Address) {
  const resolver = (await publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: postgradMarketAddress,
    functionName: "resolver",
  })) as Address;

  return localWalletFor(resolver, "postgrad resolver");
}

/** Looks an on-chain role up among the local dev accounts, as an operator would. */
function localWalletFor(address: Address, role: string) {
  for (let index = 0; index < LOCAL_DEV_ACCOUNT_COUNT; index += 1) {
    const wallet = walletFor(index);
    if (wallet.account.address.toLowerCase() === address.toLowerCase()) {
      return wallet;
    }
  }

  throw new Error(`${role} ${address} is not a local dev account.`);
}

async function sendOperatorTransaction(
  label: string,
  send: () => Promise<`0x${string}`>,
): Promise<void> {
  const transactionHash = await retryOnceOnNonceCollision(send);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`${label} reverted: ${transactionHash}`);
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
