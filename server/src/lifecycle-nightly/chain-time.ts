import {
  fastForwardLocalRpc,
  requestLocalRpc,
} from "src/api/services/local-dev-chain";

import { publicClient } from "./stack";

/**
 * Chain-time control for lifecycle scenarios. Two clocks govern the
 * lifecycle: on-chain gates (graduation deadline, resolution time, challenge
 * window) read block timestamps, while the AI runners' job eligibility
 * compares market timestamps against wall-clock `new Date()`. Jumps here move
 * only the chain clock — scenarios that need a runner to pick a market up
 * must still wait wall-clock, so they should use short windows and keep jumps
 * minimal to bound the drift between the two clocks.
 *
 * Scenarios run strictly sequentially and drive every market they create to
 * a terminal state before returning; that is what makes a global,
 * forward-only chain clock safe to share.
 */

export async function chainNowSeconds(): Promise<bigint> {
  const block = await publicClient.getBlock();
  return block.timestamp;
}

/** Advances the chain clock to `targetSeconds` and mines it into a block. */
export async function jumpChainTimeTo(targetSeconds: bigint): Promise<void> {
  await fastForwardLocalRpc(publicClient, targetSeconds);
  // fastForwardLocalRpc only schedules the timestamp for the next block;
  // mining materializes it so view calls and watchers observe the new time
  // without waiting for an unrelated transaction.
  await mineBlock();
}

/**
 * Mines one block. The indexer trails the tip by one block on an idle chain,
 * so pollers mine while waiting to flush the last real transaction through.
 */
export async function mineBlock(): Promise<void> {
  await requestLocalRpc("evm_mine", []);
}
