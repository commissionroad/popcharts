import { BaseError } from "viem";

/**
 * Same-nonce race handling for local stacks, where one signing account is
 * shared by every server-side service (deployer, manager, keeper, review and
 * resolution runners) and by the operator-keyed calls that must originate from
 * that same on-chain role. Two processes reading `eth_getTransactionCount`
 * concurrently prepare the same nonce; the winner's transaction is mined and
 * the loser's is rejected without ever entering a block.
 *
 * Retrying is safe precisely because the losing transaction was never accepted
 * *and* the contested nonce is already mined: viem re-reads the pending nonce
 * on the next attempt, so the retry is a fresh send at a free nonce rather
 * than a second copy of a transaction that already landed. Retry at the
 * individual send, never around a multi-transaction sequence — a sequence
 * retry would resend the steps that did succeed.
 */

/**
 * Both halves of that safety argument are load-bearing, and only one node
 * phrase carries both, so the match is exactly "nonce too low" — the local dev
 * node spells it "Nonce too low. Expected nonce to be N but got M.", geth-family
 * nodes use the bare phrase, and both contain this substring. The match walks
 * the whole error chain because the phrase usually arrives on a nested cause.
 *
 * Two neighbouring phrases are deliberately NOT matched. These sends move
 * collateral (keeper complete-set arbitrage, venue liquidity seeding), so a
 * retry there is real money spent twice:
 *
 * - "already known" / "transaction already imported": the identical raw
 *   transaction is already in the node's pool, i.e. ours was *accepted*, not
 *   rejected. viem's HTTP transport resubmits a send whose response was lost,
 *   which is how this surfaces. The pending nonce has already advanced past
 *   our transaction, so a retry is a second distinct transaction that also
 *   lands. Note that viem itself folds this phrase into `NonceTooLowError`,
 *   so never classify on viem's synthesized wording — only on the node's.
 * - "replacement transaction underpriced": our transaction was rejected, but a
 *   *different* one is still pending at the contested nonce, so the nonce is
 *   not free and the retry queues behind a transaction this module cannot
 *   identify. The same phrase is also what a node returns for a deliberate
 *   replacement attempt with too small a fee bump, where an extra send is
 *   plainly wrong rather than merely unproven.
 *
 * Do not widen this back to a bare /nonce/ either: that matches contract
 * reverts carrying the word — an `InvalidNonce` revert on the permit path —
 * and turns one deterministic failure into two.
 */
const LOST_NONCE_RACE_PATTERN = /nonce too low/i;

/** True when `error` is a lost same-nonce race whose contested nonce is mined. */
export function isNonceCollision(error: unknown): boolean {
  if (error instanceof BaseError) {
    return (
      error.walk(
        (cause) =>
          cause instanceof Error && LOST_NONCE_RACE_PATTERN.test(cause.message),
      ) !== null
    );
  }
  return error instanceof Error && LOST_NONCE_RACE_PATTERN.test(error.message);
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
