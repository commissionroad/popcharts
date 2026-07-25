import { BaseError } from "viem";

/**
 * Same-nonce race handling for local stacks, where one signing account is
 * shared by every server-side service (deployer, manager, keeper, review and
 * resolution runners) and by the operator-keyed calls that must originate from
 * that same on-chain role. Two processes reading `eth_getTransactionCount`
 * concurrently prepare the same nonce, and the loser's transaction is rejected
 * without ever entering a block.
 *
 * Retrying is safe precisely because the losing transaction was never
 * accepted: viem re-reads the pending nonce on the next attempt, so the retry
 * is a fresh send rather than a second copy of a transaction that already
 * landed. Retry at the individual send, never around a multi-transaction
 * sequence — a sequence retry would resend the steps that did succeed.
 */

/**
 * Hardhat surfaces a same-nonce race as "nonce too low", "replacement
 * transaction underpriced", or "already known" — sometimes only on a nested
 * cause — so the match walks the full error chain.
 */
const NONCE_COLLISION_PATTERN =
  /nonce|replacement transaction underpriced|already known/i;

export function isNonceCollision(error: unknown): boolean {
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

/** Re-sends once when `send` lost a same-nonce race; rethrows anything else. */
export async function retryOnceOnNonceCollision<T>(
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
