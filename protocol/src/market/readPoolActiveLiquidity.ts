import type { Address, Hex, PublicClient } from "viem";

const STATE_VIEW_LIQUIDITY_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getLiquidity",
    outputs: [{ name: "liquidity", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

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
    abi: STATE_VIEW_LIQUIDITY_ABI,
    address: args.stateView,
    args: [args.poolId],
    functionName: "getLiquidity",
  });
}
