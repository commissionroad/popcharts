import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import { boundedPoolOrderManagerAbi } from "../../../src/generated/postgrad-venue.js";

/** Stored order-manager state for one maker order; zero owner means deleted. */
export type BoundedOrderState = {
  readonly enablePartialFill: boolean;
  readonly indexedTick: number;
  readonly liquidity: bigint;
  readonly owner: Address;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly zeroForOne: boolean;
};

/**
 * Reads one maker order from the bounded order manager with a checksummed
 * owner, so smoke and inspection flows share the getOrder tuple decoding and
 * the "zero owner means filled or cancelled" convention.
 */
export async function readBoundedOrder(args: {
  readonly orderId: number;
  readonly orderManager: Address;
  readonly poolId: Hex;
  readonly publicClient: PublicClient;
}): Promise<BoundedOrderState> {
  const order = await args.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: args.orderManager,
    args: [args.poolId, args.orderId],
    functionName: "getOrder",
  });
  return { ...order, owner: getAddress(order.owner) };
}
