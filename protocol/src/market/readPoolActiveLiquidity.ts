import type { Address, Hex, PublicClient } from "viem";

import { stateViewAbi } from "../generated/third-party/venue.js";

/**
 * Reads a pool's currently active liquidity through the venue StateView, so
 * seeding, keeper, and health flows share one definition of "the pool has
 * depth" instead of each hand-rolling the StateView call.
 */
export async function readPoolActiveLiquidity(args: {
  readonly poolId: Hex;
  readonly publicClient: PublicClient;
  readonly stateView: Address;
}): Promise<bigint> {
  return args.publicClient.readContract({
    abi: stateViewAbi,
    address: args.stateView,
    args: [args.poolId],
    functionName: "getLiquidity",
  });
}
